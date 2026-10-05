#!/usr/bin/env python3
"""Seed the fork's own UI strings into every non-English lingui catalog.

Upstream fills non-English msgstr via Weblate; we have no translators, and an
empty msgstr renders as a raw {placeholder} in prod. After `lingui:extract`
re-adds our strings (empty), copy msgid -> msgstr, but ONLY for msgids that are
absent from upstream/main's catalog for that locale (i.e. ours), so upstream's
own untranslated entries stay exactly as upstream has them.

Edits the .po text in place (no polib round trip: re-serialising rewrites every
catalog and buries the real change). Stdlib only.

usage: seed-po.py <upstream-ref>      (run from the repo root)
"""
import glob
import re
import subprocess
import sys

FIELD = re.compile(r'^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s')


def split_blocks(text):
    """Entries are separated by blank lines; keep every line so we can rejoin verbatim."""
    return text.split('\n\n')


def parse(block):
    """-> (key, fields) where fields maps field name -> (first_line_idx, [raw lines of that field])."""
    lines = block.split('\n')
    fields, cur = {}, None
    for i, ln in enumerate(lines):
        m = FIELD.match(ln)
        if m:
            cur = m.group(1)
            fields[cur] = (i, [ln])
        elif ln.startswith('"') and cur:
            fields[cur][1].append(ln)
        elif ln.startswith('#~'):
            return None, None  # obsolete entry
        else:
            cur = None
    if 'msgid' not in fields:
        return None, None
    raw = lambda f: ''.join(re.sub(r'^[a-z_\[\]0-9]*\s*', '', l, count=1) if k == 0 else l
                            for k, l in enumerate(fields[f][1])) if f in fields else ''
    return (raw('msgctxt'), raw('msgid'), raw('msgid_plural')), (lines, fields)


def seed_block(block, key, lines, fields):
    """Return the block with empty msgstr copied from msgid (plural: [0]=msgid, rest=plural), or None if nothing to do."""
    if key[1] in ('', '""'):
        return None  # header entry
    strs = sorted((f for f in fields if f.startswith('msgstr')), key=lambda f: (len(f), f))
    if not strs:
        return None
    def empty(f):
        ls = fields[f][1]
        return len(ls) == 1 and re.match(r'^msgstr(\[\d+\])?\s+""\s*$', ls[0])
    if not all(empty(f) for f in strs):
        return None
    def clone(src, dst):
        out = [re.sub(r'^msgid(_plural)?', dst, fields[src][1][0], count=1)] + fields[src][1][1:]
        return out
    new = {}
    for f in strs:
        if f == 'msgstr':
            new[f] = clone('msgid', 'msgstr')
        else:
            idx = int(re.search(r'\d+', f).group())
            src = 'msgid' if idx == 0 or 'msgid_plural' not in fields else 'msgid_plural'
            new[f] = [re.sub(r'^msgid(_plural)?', f, fields[src][1][0], count=1)] + fields[src][1][1:]
    out, skip = [], set()
    for f, (start, ls) in fields.items():
        if f in new:
            skip.add(start)
    i = 0
    while i < len(lines):
        f = next((g for g, (st, _) in fields.items() if st == i and g in new), None)
        if f:
            out += new[f]
            i += len(fields[f][1])
        else:
            out.append(lines[i])
            i += 1
    return '\n'.join(out)


def keys_of(text):
    return {k for k, _ in (parse(b) for b in split_blocks(text)) if k}


def main(ref):
    base = 'fluxer_app/src/features/i18n/locales'
    total = 0
    for path in sorted(glob.glob(f'{base}/*/messages.po')):
        if path.split('/')[-2] == 'en':
            continue
        up = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
        upstream = keys_of(up.stdout) if up.returncode == 0 else set()
        text = open(path, encoding='utf-8').read()
        blocks, n = split_blocks(text), 0
        for i, b in enumerate(blocks):
            key, rest = parse(b)
            if not key or key in upstream:
                continue
            new = seed_block(b, key, *rest)
            if new is not None:
                blocks[i] = new
                n += 1
        if n:
            open(path, 'w', encoding='utf-8').write('\n\n'.join(blocks))
        total += n
    print(f'seeded {total} fork strings across non-en catalogs')


if __name__ == '__main__':
    main(sys.argv[1])
