# Smoke test — first full pass

A manual pass over the calculations and flows most likely to produce a wrong
number or a security gap. Ordered by risk: **if you stop halfway, stop at the
end of section 3.** Sections 1–3 are the things an auditor would find first.
Sections 4–6 are polish; section 7 covers the sign-in, invite, survey and
storage flows that only a live Supabase project exercises.

None of this needs a test framework. It needs your eyes on numbers you can
check by hand.

> Notation: **✅** what right looks like · **🚩** what a real bug looks like.

---

## 0. Before you start

- [ ] Confirm the working tree is clean and on the commit you mean to test.
- [ ] `bash deploy/preflight.sh` — expect zero problems. It will name any
      environment variable the code reads that `.env` is missing.
- [ ] `npm test` — 1,143+ tests should pass.
- [ ] `npx tsc --noEmit` — silent.
- [ ] `npm run build` — the same build the Docker image uses.
      ✅ `.next/standalone/server.js` exists afterwards.
- [ ] `npm run dev` and load the dashboard.

> The dev server runs webpack and `next build` runs Turbopack. If something
> renders in dev but not in a production build, that divergence is the first
> place to look — it has caused a CSS outage before.

---

## 1. The numbers that were wrong (highest risk)

Four of these produced confidently wrong output before. They are the reason to
do this pass at all.

### 1.1 Waste diversion rate — `/kpis`

The filter used to match source types the app never writes, so it read 0.0%
forever.

- [ ] Load `/kpis` with demo data present.
- ✅ Diversion rate is a plausible non-zero percentage.
- 🚩 Exactly `0.0%` while `/data` clearly shows recycled or composted tonnage.
      That is the old bug, not an empty database.

### 1.2 Renewable electricity share — `/kpis`

Same class: it tested `accounting_method === 'market'`, but the CHECK only
permits `location_based` / `market_based`.

- [ ] Same page.
- ✅ Non-zero if any market-based renewable electricity is entered.
- 🚩 `0.0%` alongside visible renewable entries.

### 1.3 Energy intensity — `/kpis`

Compared `'kwh'` against a stored `'kWh'`, so it was permanently blank.

- ✅ A number with a unit.
- 🚩 Blank or `—` while energy entries exist.

### 1.4 Goal progress under a scope filter — `/dashboard`

It compared an org-wide baseline against a scope-filtered current figure, so a
business unit at 10% of target could read 100%.

- [ ] Load `/dashboard` unfiltered, note goal progress.
- [ ] Apply a scope filter to one business unit.
- ✅ Progress is **withheld** under a scope filter, with a note saying why.
- 🚩 A progress percentage that changes with the filter — especially one that
      jumps toward 100%.

---

## 2. Consolidation boundary (migration 028)

The single most consequential setting in the platform. It decides what every
total means.

- [ ] `/settings` → **Boundary**. Three approach cards, a proportional bar, and
      a per-site table.
- [ ] Note today's Scope 1 and Scope 2 totals on `/dashboard`.
- [ ] Set one site to **50% ownership** and **not controlled**.
- [ ] Switch approach to **Equity share**. Return to `/dashboard`.
- ✅ Scope 1 and 2 fall by roughly half of that site's contribution.
- [ ] Switch to **Operational control**.
- ✅ That site is **excluded entirely** (it is not controlled), not halved.
- [ ] Switch to **Financial control**.
- ✅ Totals change in a way you can explain out loud. If you cannot explain it,
      that is the finding.
- ✅ The per-site table dims the column the current approach ignores — equity
      stake under operational control, control flag under equity share.
- 🚩 Totals identical across all three approaches. That means the share is not
      being applied and every number is wrong.

**Known and deliberate:** Scope 3 is *not* boundary-adjusted. That is
documented in `lib/disclosure-metrics.ts`. Confirm it reads as intended rather
than as an oversight, because someone will ask.

---

## 3. Intensity denominators (migration 027)

The old bug here overstated intensity by up to 50%: the numerator covered every
site, the denominator counted only sites that had reported a floor area.

- [ ] `/metrics`. Six starter metrics; the one used as the denominator is
      ringed.
- [ ] Enter a revenue figure for the current year, organization-wide.
- [ ] `/settings` → Boundary → set the intensity denominator to revenue.
- [ ] `/disclosures` (or `/kpis`).
- ✅ Intensity reports as tCO₂e per unit revenue, with the right unit string.
- [ ] Now clear that revenue value.
- ✅ Intensity reports **`missing`**, with a note — not an estimate, not zero,
      not a silently smaller denominator.
- 🚩 A number that still appears after the denominator is gone.

### 3.1 Stock versus flow — the trap worth ten minutes

This one silently distorts every intensity figure the metric feeds, and it
produced >100% turnover and ~11× overstated training hours before it was fixed.

- [ ] `/social`. Enter **headcount for two different sites**, on two different
      dates, in the same year.
- ✅ Org headcount is the **latest reading per site, summed across sites**.
      Two sites at 100 and 150 reads **250**, not 150 (one site's latest) and
      not 500 (everything summed).
- [ ] Add a second, later headcount reading for one of those sites.
- ✅ The total moves by the difference for that site only.
- 🚩 The total roughly doubles — readings are being summed rather than replaced.

---

## 4. New surfaces (migrations 023–026)

### 4.1 Social & governance — `/social`

- [ ] Enter one metric from each family: water, waste, safety, workforce,
      training, governance.
- ✅ A governance metric can be entered **without a site** (it is entity-level).
      This is what made `site_id` nullable.
- ✅ Rates — TRIR, DART, LTIR, turnover, board independence — are derived, never
      stored, and each states its hours basis.
- ✅ TRIR states whether it is on the 200,000 or 1,000,000 hour basis. GRI 403-9
      permits either and **requires** you to say which.
- [ ] Try entering a value in the wrong unit.
- ✅ Rejected with a readable message. It must never silently coerce.

### 4.2 Regulatory tracker — `/regulations`

- [ ] 21 regimes listed. Confirm CBAM, EUDR, PFAS and PPWR are among them.
- ✅ Every entry shows sources, a confidence rating, and a last-verified date.
- ✅ Confidence is **capped as an entry ages** — an old entry cannot read as
      high confidence. Staleness thresholds are 45 and 120 days.
- [ ] Open the **capability panel** on a regime.
- ✅ It links to what is already built for that regime, and says `not_built`
      where nothing is. Five regimes are honestly marked not built and three as
      no action required — seeing those is the feature working, not a gap.

### 4.3 Watch queue — `/regulations` → watch

- [ ] Open it with no AI key configured.
- ✅ The tracker still works as a reference. The queue says it is not
      configured rather than erroring.
- [ ] If you configure a key, run one watch.
- ✅ Proposals require review before landing, and carry no confidence rating,
      verification date, or source of their own.

### 4.4 Data quality — emission entry drawer

- [ ] `/data`, open the emission drawer.
- ✅ Measured / calculated / estimated as three buttons.
- [ ] Choose **estimated** and try to save without a basis.
- ✅ Rejected with a readable sentence, not a raw CHECK violation.
- [ ] Save a measured entry, then an estimated one with a basis.
- [ ] `/disclosures`.
- ✅ The data-quality summary weights by **emissions, not row count** — one
      estimated entry covering 40% of your footprint should dominate fifty
      measured small ones.

---

## 5. Database-level guarantees

These are enforced by CHECK constraints, so they hold no matter what the
application does. Worth confirming once, in the Supabase SQL editor, that they
survived the migration into your project.

- [ ] `supabase/verify_install.sql` → **22 of 22 pass**.
- [ ] Try to insert a regulatory item with an empty `sources` array.
      ✅ Rejected — an unsourced claim is unstorable.
- [ ] Try a change proposal carrying a `confidence` field.
      ✅ Rejected — the AI cannot rate its own confidence.
- [ ] Try a site with `ownership_percent` above 100.
      ✅ Rejected.

---

## 6. Deployment

- [ ] `docker compose -f deploy/docker-compose.yml build`
- ✅ Builds clean. The `COPY .next/standalone` step is the one that fails if
      `output: 'standalone'` ever gets removed.
- [ ] `DATABASE_URL=... bash deploy/migrate.sh --dry-run`
- ✅ Reports **0 pending** once every migration is applied. If you applied
      migrations by hand, it will want to apply them again because its ledger
      table is missing — harmless for 008 onward (re-runnable), but let it run
      so future upgrades are tracked.

---

## 7. Sign-in, invite, survey and storage flows (live Supabase only)

These were fixed in code and pinned by tests where a test could reach them, but
each one is a flow across the browser, Supabase Auth and storage that only a
live deployment exercises. Apply 037 first.

### 7.1 Supplier survey while signed out

The survey API used to sit behind the login redirect, so it only worked when the
person testing it happened to be signed in.

- [ ] Copy a survey link from Suppliers. Open it in a **private window**.
- [ ] Answer a question, wait for the autosave indicator, then submit.
- ✅ "Saved" appears; submission shows the thank-you screen; the invitation
      reads *submitted* back in Suppliers.
- 🚩 "Saved" never appears, or submit says it failed.

### 7.2 Inviting a colleague

The invite produced an account with no usable profile and a link to a page that
did not exist.

- [ ] Settings → Team → invite a second address you control, as Editor.
- [ ] Open the email in a private window and follow the link.
- ✅ "Set your password" page; after setting it you land on the dashboard and
      see the organization's data.
- 🚩 A 404, an empty dashboard, or "This account is not active".

### 7.3 Deactivation actually removes access

- [ ] As admin, deactivate the colleague from 7.2. In their window, reload.
- ✅ "This account is not active" with a Sign out button.
- 🚩 They can still see data.
- [ ] Reactivate them; reload their window. ✅ Data is back.

### 7.4 Sign-up is closed after the first organization

- [ ] Signed out, open `/signup`.
- ✅ "Sign-up is closed on this deployment…" (unless `ALLOW_PUBLIC_SIGNUP=true`).

### 7.5 Evidence everywhere, including practice mode

- [ ] Attach a PDF on each of: Environmental Data Entry, Social & Governance,
      Business Metrics, a Project (board and list), a Goal's page, the
      Materiality assessment summary, and a Site in Settings.
- ✅ Each paperclip shows the count; the document opens from the dialog.
- [ ] Settings → enter practice mode, and attach one document there.
- ✅ It uploads. 🚩 A storage "row-level security" error — that is the
      home-organization bug coming back.

### 7.6 Practice workspace reset

- [ ] In practice mode (with the seeded demo data), click Reset.
- ✅ A fresh practice workspace. 🚩 A foreign-key error mentioning `audit_log`.

### 7.7 Goal detail and import review pages

Both read route params synchronously, which Next 16 no longer supports, so in a
production build every one returned 404.

- [ ] `npm run build && npm start`, open a goal from Goals, and open a staged
      import from Environmental Data Entry → Import data.
- ✅ Both render.

---

## Recording what you find

For anything wrong, capture **the inputs, the figure BROC produced, and the
figure you expected**. That is enough to fix it; you do not need to find the
cause. A wrong number takes precedence over a missing feature every time.
