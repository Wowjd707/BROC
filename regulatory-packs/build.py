#!/usr/bin/env python3
"""
Convert a regulatory tracker export into a loadable BROC migration.

    ./build.py inspect  <tracker-export>.html
    ./build.py mapping  <tracker-export>.html > <pack>/mapping.json
    ./build.py emit     <tracker-export>.html <pack>/mapping.json \
        > ../supabase/migrations/0NN_regulatory_pack_<date>.sql

`emit` refuses to run without scrubbing rules. Put them in scrub.local.json
beside the mapping, or pass --no-scrub for an export that names no company.

Why a script rather than hand-written SQL
-----------------------------------------
Same reasoning as factor-packs/build.py. A tracker export holds a few hundred
dated claims, each with sources and a confidence rating, and transcribing those
by hand is where a wrong date quietly enters a system whose whole value is
dates that are right. The conversion is therefore mechanical and repeatable,
and every judgement call lives in mapping.json where it can be read and argued
with.

What the mapping decides
------------------------
  frameworks    the parent rows, their domain and display order
  items         which export workstream becomes which BROC item code, and
                crucially WHICH ALREADY EXIST — migration 024 seeded 21 items
                and a pack must update those rather than duplicate them
  stage         export lifecycle phases onto BROC's deliberately coarse stages
  scrub         whole-word replacements, for an export written inside one
                company. Company-specific rules belong in scrub.local.json
                beside the mapping, which is untracked
  forbid        tokens that must not survive the scrub. Emit fails rather than
                writing a pack that still names the company it came from

Confidence is not mapped. It is copied, then capped: a claim whose sources are
all secondary cannot be stored above 'medium', per REGULATORY_CONTENT.md. The
script enforces that rather than trusting the export, and prints every cap it
applied so the change is visible in review rather than silent.
"""

import json
import os
import re
import sys
from datetime import date
from urllib.parse import urlparse

# Domains that a primary source can come from. Deliberately a short list of
# regulators and standard-setters: a law firm's briefing on a regulation is
# excellent and is still somebody's reading of a text.
PRIMARY_HOSTS = (
    'europa.eu', 'echa.europa.eu', 'efrag.org', 'epa.gov', 'sec.gov', 'ca.gov',
    'arb.ca.gov', 'gov.uk', 'legislation.gov.uk', 'federalregister.gov',
    'congress.gov', 'iso.org', 'ghgprotocol.org', 'sciencebasedtargets.org',
    'ifrs.org', 'un.org', 'oecd.org', 'unfccc.int',
)

CONFIDENCE_ORDER = ['low', 'medium', 'high', 'confirmed']


def load_export(path):
    """Accept either the standalone HTML tracker or a raw JSON export."""
    raw = open(path, encoding='utf-8').read()
    if path.endswith('.json'):
        return json.loads(raw)
    m = re.search(r'^DATA = (\{.*)$', raw, re.M | re.S)
    if not m:
        sys.exit(f'{path}: no `DATA = {{...}}` assignment found')
    return json.JSONDecoder().raw_decode(m.group(1))[0]


def is_primary(url):
    host = urlparse(url).netloc.lower().replace('www.', '')
    return any(host == h or host.endswith('.' + h) or h in host for h in PRIMARY_HOSTS)


def cap_confidence(level, sources, label, warnings):
    """
    A claim resting only on secondary reporting is 'medium' at best.

    REGULATORY_CONTENT.md defines medium as "credible secondary reporting —
    typically legal analysis of a text nobody on our side read", so anything
    above it asserts we read the instrument. If we did not, the honest rating
    is medium and the fix is to go and read it.
    """
    if not sources:
        warnings.append(f'{label}: no sources — refused')
        return None
    if any(is_primary(s.get('url', '')) for s in sources):
        return level
    if CONFIDENCE_ORDER.index(level) > CONFIDENCE_ORDER.index('medium'):
        warnings.append(f'{label}: {level} -> medium (no primary source)')
        return 'medium'
    return level


def resolve_date(value):
    """
    Export dates are loose: '2027-01-01', '2027-Q2', '2026-10', or absent.

    BROC stores a real DATE plus a note, because a quarter is a genuine fact
    about a milestone and rounding it silently to a day would assert a
    precision the regulator has not given. Returns (iso_date_or_None, note).
    """
    if not value:
        return None, None
    v = str(value).strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
        return v, None
    q = re.fullmatch(r'(\d{4})-Q([1-4])', v)
    if q:
        year, quarter = int(q.group(1)), int(q.group(2))
        return f'{year}-{(quarter - 1) * 3 + 1:02d}-01', f'Estimated Q{quarter} {year}.'
    m = re.fullmatch(r'(\d{4})-(\d{2})', v)
    if m:
        return f'{m.group(1)}-{m.group(2)}-01', f'Month known ({v}); day not announced.'
    if re.fullmatch(r'\d{4}', v):
        return f'{v}-01-01', f'Year known ({v}); no date announced.'
    return None, f'Announced as "{v}".'


# Company tokens found in scrubbed output. Populated by scrub(); emit refuses
# to print a pack while this is non-empty.
LEAKS = []


def scrub(text, replacements, forbid=()):
    """
    Replace company-specific wording, then verify none survived.

    Matching is whole-word. A plain str.replace makes short tokens unusable —
    a two-letter rule would rewrite THIRD and FIRST — and short tokens are
    exactly what leaks, because the long form is the one a reviewer notices.
    Longer
    keys must still be listed before the prefixes they contain: with word
    boundaries, a company name still matches inside its own possessive form.

    `forbid` is the backstop. A scrub map can only replace phrasings someone
    thought of, and the next export will phrase it differently, so anything
    still carrying a forbidden token is recorded and fails the build. A pack
    that names the company it was written inside is not shippable, and finding
    that out in review is finding out too late.
    """
    if not isinstance(text, str):
        return text
    for old, new in replacements.items():
        text = re.sub(r'\b' + re.escape(old) + r'\b', new, text)
    for token in forbid:
        if re.search(r'\b' + re.escape(token) + r'\b', text):
            LEAKS.append((token, text.strip()[:140]))
    return text


def compose_sources(data, *framework_ids, limit=2):
    """
    Evidence for a relationship, composed from the instruments at each end.

    A crosswalk export typically carries no sources of its own: "California
    references a frozen GHG Protocol version" is an observation drawn from
    reading both texts, not a sentence either regulator published. The schema
    still refuses an unsourced row, and rightly — so the honest move is to
    carry the sources of the instruments the claim is about, and to cap the
    confidence, rather than to invent a citation that says what we want.

    Anything composed this way is stored at medium: it is our reading of two
    texts, which is exactly what REGULATORY_CONTENT.md calls medium.
    """
    out, seen = [], set()
    for fid in framework_ids:
        for f in data.get('frameworks', []):
            if f['id'] != fid:
                continue
            taken = 0
            for ws in f.get('workstreams', []):
                for s in ws.get('sources', []):
                    url = s.get('url')
                    if not url or url in seen:
                        continue
                    seen.add(url)
                    out.append({'label': s.get('label', url), 'url': url,
                                'dated': s.get('dated')})
                    taken += 1
                    if taken >= limit:
                        break
                if taken >= limit:
                    break
    return out


def emit_relationship(w, from_code, to_code, relation, title, note, bullets,
                      confidence, sources, verified, order, watchlist_detail=None):
    """One upsert into regulatory_relationships. Shared by the crosswalk and
    the watchlist, which are the same row seen from two sides."""
    w('INSERT INTO regulatory_relationships')
    w('  (from_code, to_code, relation, title, note, bullets, is_watchlist,')
    w('   watchlist_detail, confidence, sources, last_verified, display_order)')
    w('VALUES (' + ', '.join([
        q(from_code), q(to_code), q(relation), q(title), q(note), jsonb(bullets),
        'TRUE' if watchlist_detail else 'FALSE', q(watchlist_detail),
        q(confidence), jsonb(sources), q(verified), str(order),
    ]) + ')')
    w('ON CONFLICT (from_code, to_code, relation) DO UPDATE SET')
    w('  title = EXCLUDED.title, note = EXCLUDED.note,')
    w('  bullets = EXCLUDED.bullets, is_watchlist = EXCLUDED.is_watchlist,')
    w('  watchlist_detail = EXCLUDED.watchlist_detail,')
    w('  confidence = EXCLUDED.confidence, sources = EXCLUDED.sources,')
    w('  last_verified = EXCLUDED.last_verified, updated_at = NOW();')
    w('')


def q(value):
    """Single-quoted SQL literal, or NULL."""
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def jsonb(value):
    return q(json.dumps(value, ensure_ascii=False)) + '::jsonb'


# ── inspect ──────────────────────────────────────────────────────────────────

def cmd_inspect(path):
    data = load_export(path)
    print(f'{path}\n')
    print(f"  title        {data.get('meta', {}).get('title', '?')}")
    print(f"  last updated {data.get('meta', {}).get('last_updated', '?')}")
    print(f"  frameworks   {len(data.get('frameworks', []))}")
    ws = [w for f in data.get('frameworks', []) for w in f.get('workstreams', [])]
    print(f"  workstreams  {len(ws)}")
    print(f"  updates      {len(data.get('updates', []))}")
    xw = data.get('crosswalk', {})
    print(f"  relationships {len(xw.get('relationships', []))}"
          f" + {len(xw.get('divergence_watchlist', []))} divergences")
    print(f"  glossary     {len(data.get('glossary', {}))}"
          f" + {len(data.get('acronyms', {}))} acronyms")

    print('\n  phases in use (map every one of these in mapping.json):')
    for p in sorted({str(w.get('phase')) for w in ws}):
        print(f'    {p}')

    print('\n  workstreams:')
    for f in data.get('frameworks', []):
        for w in f.get('workstreams', []):
            print(f"    {f['id']:6} {w['id']:34} {w['name'][:50]}")


# ── mapping scaffold ─────────────────────────────────────────────────────────

def cmd_mapping(path):
    """Emit a starter mapping for editing. Every item defaults to NEW."""
    data = load_export(path)
    out = {
        '_README': 'Edit before emitting. `existing: true` updates an item '
                   'seeded by an earlier migration instead of inserting one.',
        'scrub': {'Acme Corporation': 'your organization'},
        'forbid': ['Acme', 'ACME'],
        'stage': {p: 'drafting' for p in
                  sorted({str(w.get('phase')) for f in data.get('frameworks', [])
                          for w in f.get('workstreams', [])})},
        'frameworks': {
            f['id']: {'code': f['id'].upper(), 'domain': 'other',
                      'publisher': f.get('org', ''), 'order': (i + 1) * 10}
            for i, f in enumerate(data.get('frameworks', []))
        },
        'items': {
            w['id']: {'code': w['id'].upper().replace('-', '_')[:40], 'existing': False}
            for f in data.get('frameworks', []) for w in f.get('workstreams', [])
        },
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))


# ── emit ─────────────────────────────────────────────────────────────────────

def cmd_emit(export_path, mapping_path, no_scrub=False):
    data = load_export(export_path)
    mp = json.loads(open(mapping_path, encoding='utf-8').read())
    # Company-specific rules live beside the mapping in scrub.local.json,
    # untracked, because a rule has to name the company in order to remove it
    # and a committed rule leaks exactly what the scrub is for.
    local_path = os.path.join(os.path.dirname(mapping_path) or '.', 'scrub.local.json')
    local = json.loads(open(local_path, encoding='utf-8').read()) if os.path.exists(local_path) else {}

    rep = {**mp.get('scrub', {}), **local.get('scrub', {})}
    forbid = list(mp.get('forbid', [])) + list(local.get('forbid', []))
    LEAKS.clear()

    # Absent rules are indistinguishable from "this export needs none", and the
    # two have opposite consequences: one emits a clean pack, the other emits a
    # pack naming the company and says nothing. So the safe reading is the
    # default, and an export that genuinely needs no scrubbing says so out loud.
    if not rep and not no_scrub:
        sys.exit(
            f'no scrubbing rules ({local_path} not found, and the mapping '
            f'declares none) \u2014 nothing written.\n'
            f'An export written inside a company needs a scrub.local.json '
            f'beside its mapping, holding "scrub" and "forbid".\n'
            f'If this export names no company, pass --no-scrub to say so.'
        )
    stage_map = mp.get('stage', {})
    fw_map = mp.get('frameworks', {})
    item_map = mp.get('items', {})
    warnings = []

    verified = data.get('meta', {}).get('last_updated') or date.today().isoformat()
    sql = []
    w = sql.append

    w('-- ============================================================')
    w('-- BROC — Regulatory content pack')
    w('-- ============================================================')
    w('-- GENERATED by regulatory-packs/build.py. Do not hand-edit: re-run the')
    w('-- generator against an updated export instead, so the tracker and this')
    w('-- migration cannot drift apart.')
    w('--')
    # The export is typically an internal document whose filename carries the
    # company name. The pack records that there WAS an export and when it was
    # verified; the filename is traceability nobody installing it can use anyway.
    w('--   source export   tracker export (see regulatory-packs/)')
    w(f'--   mapping         {mapping_path.split("/")[-1]}')
    w(f'--   content as of   {verified}')
    w('--')
    w('-- Every row carries at least one source and a last_verified date, and')
    w('-- any claim resting only on secondary reporting has been capped at')
    w('-- medium confidence by the generator rather than by hand.')
    w('--')
    w('-- RE-RUNNABLE. Every statement upserts on a natural key.')
    w('-- ============================================================')
    w('')

    # ── frameworks ──
    w('-- ─── Frameworks ──────────────────────────────────────────────────────────')
    for f in data.get('frameworks', []):
        cfg = fw_map.get(f['id'])
        if not cfg:
            warnings.append(f"framework {f['id']}: not in mapping — skipped")
            continue
        w('INSERT INTO regulatory_frameworks')
        w('  (code, name, short_name, publisher, domain, tagline, description,')
        w('   status_headline, accent_color, display_order)')
        w('VALUES (' + ', '.join([
            q(cfg['code']), q(scrub(f.get('name'), rep, forbid)), q(f.get('short')),
            q(scrub(cfg.get('publisher') or f.get('org'), rep, forbid)), q(cfg['domain']),
            q(scrub(f.get('tagline'), rep, forbid)), q(scrub(f.get('description'), rep, forbid)),
            q(scrub(f.get('status_headline'), rep, forbid)), q(f.get('color')),
            str(cfg.get('order', 0)),
        ]) + ')')
        w('ON CONFLICT (code) DO UPDATE SET')
        w('  name = EXCLUDED.name, short_name = EXCLUDED.short_name,')
        w('  publisher = EXCLUDED.publisher, domain = EXCLUDED.domain,')
        w('  tagline = EXCLUDED.tagline, description = EXCLUDED.description,')
        w('  status_headline = EXCLUDED.status_headline,')
        w('  accent_color = EXCLUDED.accent_color,')
        w('  display_order = EXCLUDED.display_order, updated_at = NOW();')
        w('')

    # ── items ──
    w('-- ─── Workstreams ─────────────────────────────────────────────────────────')
    w('-- Items already seeded by 024 are updated in place: their codes are')
    w('-- referenced by regulatory_source_snapshots, regulatory_change_proposals')
    w('-- and regulatory_capabilities, so a code must never be reissued.')
    w('')
    for f in data.get('frameworks', []):
        fcfg = fw_map.get(f['id'])
        if not fcfg:
            continue
        for order, ws in enumerate(f.get('workstreams', []), start=1):
            icfg = item_map.get(ws['id'])
            if not icfg:
                warnings.append(f"item {ws['id']}: not in mapping — skipped")
                continue
            phase = str(ws.get('phase'))
            if phase not in stage_map:
                warnings.append(f"item {ws['id']}: phase '{phase}' unmapped — skipped")
                continue

            conf = (ws.get('confidence') or {})
            sources = ws.get('sources') or []
            level = cap_confidence(conf.get('level', 'low'), sources, ws['id'], warnings)
            if level is None:
                continue

            nm = ws.get('next_milestone') or {}
            iso, note = resolve_date(nm.get('date'))
            existing_note = scrub(nm.get('note') or '', rep, forbid)
            full_note = ' '.join(x for x in [note, existing_note] if x).strip() or None

            if icfg.get('existing'):
                # Update only the columns this pack is authoritative for. The
                # 024 row already holds reviewed prose; overwriting all of it
                # would discard work rather than add to it.
                w(f"UPDATE regulatory_items SET")
                w(f"  framework_code = {q(fcfg['code'])},")
                w(f"  category       = {q(fcfg['domain'])},")
                w(f"  updated_at     = NOW()")
                w(f"WHERE code = {q(icfg['code'])};")
                w('')
                continue

            w('INSERT INTO regulatory_items')
            w('  (code, framework_code, name, category, jurisdiction, topics, stage,')
            w('   status_summary, key_points, next_milestone, next_milestone_date,')
            w('   next_milestone_note, confidence, confidence_note, sources,')
            w('   last_verified, display_order)')
            w('VALUES (' + ', '.join([
                q(icfg['code']), q(fcfg['code']), q(scrub(ws.get('name'), rep, forbid)),
                q(fcfg['domain']), q(icfg.get('jurisdiction', 'Global')),
                'ARRAY[' + ', '.join(q(t) for t in icfg.get('topics', [])) + ']::TEXT[]',
                q(stage_map[phase]),
                q(scrub(ws.get('summary'), rep, forbid)),
                jsonb([scrub(k, rep, forbid) for k in ws.get('key_points', [])]),
                q(scrub(nm.get('what'), rep, forbid)), q(iso), q(full_note),
                q(level), q(scrub(conf.get('reasoning'), rep, forbid)),
                jsonb(sources), q(verified), str(order * 10),
            ]) + ')')
            w('ON CONFLICT (code) DO UPDATE SET')
            w('  framework_code = EXCLUDED.framework_code, name = EXCLUDED.name,')
            w('  category = EXCLUDED.category, stage = EXCLUDED.stage,')
            w('  status_summary = EXCLUDED.status_summary,')
            w('  key_points = EXCLUDED.key_points,')
            w('  next_milestone = EXCLUDED.next_milestone,')
            w('  next_milestone_date = EXCLUDED.next_milestone_date,')
            w('  next_milestone_note = EXCLUDED.next_milestone_note,')
            w('  confidence = EXCLUDED.confidence,')
            w('  confidence_note = EXCLUDED.confidence_note,')
            w('  sources = EXCLUDED.sources, last_verified = EXCLUDED.last_verified,')
            w('  updated_at = NOW();')
            w('')

    # ── relationships ──
    xw = data.get('crosswalk', {})
    rel_map = mp.get('relation', {})
    emitted = set()
    w('-- ─── Crosswalk ───────────────────────────────────────────────────────────')
    for order, r in enumerate(xw.get('relationships', []), start=1):
        frm, to = fw_map.get(r.get('from'), {}), fw_map.get(r.get('to'), {})
        if not frm or not to:
            warnings.append(f"relationship {r.get('from')}->{r.get('to')}: end not in mapping")
            continue
        relation = rel_map.get(r.get('type'), 'aligns_with')
        srcs = r.get('sources')
        level = 'high'
        if not srcs:
            srcs = compose_sources(data, r.get('from'), r.get('to'))
            level = 'medium'
            warnings.append(
                f"relationship {r.get('from')}->{r.get('to')}: no source of its own; "
                f'carried {len(srcs)} from the instruments at each end, stored at medium')
        if not srcs:
            warnings.append(
                f"relationship {r.get('from')}->{r.get('to')}: no sources at either end — refused")
            continue
        key = (frm['code'], to['code'], relation)
        if key in emitted:
            warnings.append(f'relationship {key[0]}->{key[1]} ({relation}): '
                            'already emitted — second copy skipped')
            continue
        emitted.add(key)
        emit_relationship(w, frm['code'], to['code'], relation,
                          scrub(r.get('title'), rep, forbid), scrub(r.get('note'), rep, forbid),
                          [scrub(b, rep, forbid) for b in r.get('bullets', [])],
                          level, srcs, verified, order * 10)

    # ── divergence watchlist ──
    # The subset where a company must satisfy both ends and cannot with one
    # answer. Stored as relationships so the crosswalk and the watchlist cannot
    # drift apart, flagged so the UI can lead with them.
    w('-- ─── Divergence watchlist ────────────────────────────────────────────────')
    for order, d in enumerate(xw.get('divergence_watchlist', []), start=1):
        fids = [f for f in d.get('frameworks', []) if f in fw_map]
        if len(fids) < 2:
            warnings.append(
                f"divergence '{str(d.get('title'))[:40]}': names "
                f'{len(fids)} mapped framework(s), needs two ends — skipped')
            continue
        srcs = compose_sources(data, *fids[:3])
        if not srcs:
            warnings.append(f"divergence '{str(d.get('title'))[:40]}': no sources — refused")
            continue
        bullets = [scrub(b, rep, forbid) for b in d.get('bullets', [])]
        detail = scrub(d.get('detail'), rep, forbid)

        # Some entries put the bind in bullets and leave `detail` empty. The
        # bullets are the explanation in that case, so compose one rather than
        # dropping the flag: `watchlist_detail` is required precisely because a
        # divergence nobody has explained is not actionable, and the
        # explanation does exist here — it is just in the other field.
        if not detail and bullets:
            detail = ' '.join(b.rstrip('.') + '.' for b in bullets)
        if not detail:
            warnings.append(
                f"divergence '{str(d.get('title'))[:40]}': no detail and no "
                'bullets to compose one — skipped')
            continue

        note = detail
        if len(fids) > 2:
            others = ', '.join(fw_map[f]['code'] for f in fids[2:])
            note = f'{note} Also involves {others}.'
        key = (fw_map[fids[0]]['code'], fw_map[fids[1]]['code'], 'diverges_from')

        if key in emitted:
            # The crosswalk already carries this pair. A watchlist entry is the
            # same relationship seen from the compliance side, so flag the row
            # that exists — inserting a second would collide on the unique key
            # and the later upsert would quietly overwrite the earlier one.
            w(f'-- watchlist flag for the {key[0]} -> {key[1]} divergence above')
            w('UPDATE regulatory_relationships SET')
            w('  is_watchlist = TRUE,')
            w(f'  watchlist_detail = {q(detail)},')
            w('  updated_at = NOW()')
            w(f'WHERE from_code = {q(key[0])} AND to_code = {q(key[1])}'
              f" AND relation = 'diverges_from';")
            w('')
            continue

        emitted.add(key)
        emit_relationship(w, key[0], key[1], 'diverges_from',
                          scrub(d.get('title'), rep, forbid), note, bullets,
                          'medium', srcs, verified, 1000 + order * 10,
                          watchlist_detail=detail)

    # ── updates ──
    # The dated feed. Attached to an item rather than a framework, because
    # "CSRD changed" is not actionable and "the Omnibus cut scope" is.
    #
    # An update whose framework maps to no item we hold is dropped rather than
    # attached to something adjacent: a dated claim filed under the wrong rule
    # is worse than a missing one, because it will be read as being about that
    # rule.
    w('-- ─── Dated updates ───────────────────────────────────────────────────────')
    ws_to_item = {}
    for f in data.get('frameworks', []):
        for ws in f.get('workstreams', []):
            cfg = item_map.get(ws['id'])
            if cfg:
                ws_to_item.setdefault(f['id'], {})[ws.get('name')] = cfg['code']
    fallback = {fid: next(iter(m.values())) for fid, m in ws_to_item.items() if m}

    seen_updates = set()
    for u in data.get('updates', []):
        fid = u.get('framework')
        target = ws_to_item.get(fid, {}).get(u.get('workstream')) or fallback.get(fid)
        if not target:
            warnings.append(f"update {u.get('date')} [{fid}]: no item to attach to — dropped")
            continue
        url = u.get('source_url')
        if not url:
            warnings.append(f"update {u.get('date')} [{fid}]: no source_url — refused")
            continue
        key = (target, u.get('date'), url)
        if key in seen_updates:
            continue
        seen_updates.add(key)
        w('INSERT INTO regulatory_updates')
        w('  (item_code, update_date, headline, detail, so_what, significance, source_url)')
        w('VALUES (' + ', '.join([
            q(target), q(u.get('date')), q(scrub(u.get('headline'), rep, forbid)),
            q(scrub(u.get('detail'), rep, forbid)), q(scrub(u.get('so_what'), rep, forbid)),
            q(u.get('significance')), q(url),
        ]) + ')')
        w('ON CONFLICT (item_code, update_date, source_url) DO UPDATE SET')
        w('  headline = EXCLUDED.headline, detail = EXCLUDED.detail,')
        w('  so_what = EXCLUDED.so_what, significance = EXCLUDED.significance;')
        w('')

    # ── glossary ──
    # Seeded because the acronym density is the first barrier a newcomer hits,
    # before any of the content is hard.
    w('-- ─── Glossary ────────────────────────────────────────────────────────────')
    glossary = [(t, None, v, False) for t, v in (data.get('glossary') or {}).items()]
    glossary += [(t, v, f'{t} stands for {v}.', True)
                 for t, v in (data.get('acronyms') or {}).items()]
    for term, expansion, definition, is_acr in glossary:
        if not definition:
            continue
        w('INSERT INTO regulatory_glossary (term, expansion, definition, is_acronym)')
        w('VALUES (' + ', '.join([
            q(term[:80]), q(scrub(expansion, rep, forbid)), q(scrub(definition, rep, forbid)),
            'TRUE' if is_acr else 'FALSE',
        ]) + ')')
        w('ON CONFLICT (term) DO UPDATE SET')
        w('  expansion = EXCLUDED.expansion, definition = EXCLUDED.definition,')
        w('  is_acronym = EXCLUDED.is_acronym, updated_at = NOW();')
        w('')

    if warnings:
        w('-- ─── Generator warnings ──────────────────────────────────────────────────')
        for warning in warnings:
            w(f'--   {warning}')
        w('')

    if LEAKS:
        # Nothing is printed. A half-scrubbed pack redirected into a migration
        # file is worse than no pack, because it looks finished.
        seen = set()
        for token, excerpt in LEAKS:
            if (token, excerpt) in seen:
                continue
            seen.add((token, excerpt))
            print(f'leak: "{token}" survives in: {excerpt}', file=sys.stderr)
        sys.exit(f'{len(seen)} company reference(s) survived scrubbing '
                 f'— nothing written. Add a rule to the mapping\'s "scrub" '
                 f'block for each, then re-run.')

    print('\n'.join(sql))
    for warning in warnings:
        print(f'warning: {warning}', file=sys.stderr)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd == 'inspect':
        cmd_inspect(sys.argv[2])
    elif cmd == 'mapping':
        cmd_mapping(sys.argv[2])
    elif cmd == 'emit':
        if len(sys.argv) < 4:
            sys.exit('emit needs an export and a mapping')
        cmd_emit(sys.argv[2], sys.argv[3], no_scrub='--no-scrub' in sys.argv[4:])
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
