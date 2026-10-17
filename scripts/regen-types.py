#!/usr/bin/env python3
"""
Regenerate lib/supabase/types.ts safely.

    npm run types -- --project-id <ref>
    npm run types -- --db-url postgresql://...

`supabase gen types` on its own is not safe to run in this repository, for two
reasons that are both silent failures.

1. On Windows, `> file` from PowerShell writes UTF-16LE with a BOM. The file
   looks correct in an editor, TypeScript may even parse it, and every grep for
   a new table name returns nothing because the bytes do not match ASCII. The
   first symptom is usually "this table is missing from the generated types"
   when it is in fact present.

2. The generator does not emit the hand-maintained convenience row types at the
   end of the file — `Organization`, `AppUser`, `EmissionEntry` and about
   thirty-five more. A plain regeneration deletes every one of them, and the
   build then fails in a few dozen unrelated files that never changed.

This script runs the generator, normalises the encoding to UTF-8 with LF, and
re-appends the convenience block taken from the file being replaced. It refuses
to write anything if the generated output looks wrong, because a truncated
types file is worse than a stale one.
"""

import io
import os
import re
import subprocess
import sys

TYPES_PATH = os.path.join('lib', 'supabase', 'types.ts')
MARKER = 'Convenience row types'


def read_text(path):
    raw = open(path, 'rb').read()
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        return raw.decode('utf-16')
    return raw.decode('utf-8-sig')


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)

    if not os.path.exists(TYPES_PATH):
        sys.exit(f'{TYPES_PATH} not found — run this from the repository root.')

    previous = read_text(TYPES_PATH)

    # Keep the hand-maintained tail before it is overwritten.
    if MARKER in previous:
        idx = previous.index(MARKER)
        aliases = previous[previous.rindex('\n', 0, idx) + 1:].rstrip('\n')
        alias_count = len(re.findall(r'^export type ', aliases, re.M))
    else:
        aliases, alias_count = '', 0
        print('warning: no convenience-alias block found to preserve',
              file=sys.stderr)

    print(f'generating types ({alias_count} aliases to preserve)...', file=sys.stderr)
    result = subprocess.run(
        ['npx', 'supabase', 'gen', 'types', 'typescript'] + args,
        capture_output=True, shell=(os.name == 'nt'),
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode('utf-8', 'replace'))
        sys.exit(f'supabase gen types failed ({result.returncode}) — nothing written')

    generated = result.stdout.decode('utf-8-sig').replace('\r\n', '\n')

    # Refuse obviously broken output rather than overwriting a good file.
    if 'export type Database' not in generated:
        sys.exit('generated output has no Database type — nothing written')
    if len(generated) < 10_000:
        sys.exit(f'generated output is only {len(generated)} chars — nothing written')

    out = generated.rstrip('\n') + '\n'
    if aliases:
        out += '\n' + aliases + '\n'

    io.open(TYPES_PATH, 'w', encoding='utf-8', newline='\n').write(out)

    kept = len(re.findall(r'^export type ', aliases, re.M)) if aliases else 0
    print(f'wrote {TYPES_PATH}: {len(out):,} chars, UTF-8/LF, {kept} aliases restored',
          file=sys.stderr)
    print('now run: npx tsc --noEmit', file=sys.stderr)


if __name__ == '__main__':
    main()
