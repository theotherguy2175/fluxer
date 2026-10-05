#!/usr/bin/env python3
"""Seed the fork's own UI strings into every non-English lingui catalog.

Upstream fills non-English msgstr via Weblate; we have no translators, and an
empty msgstr renders as a raw {placeholder} in prod. After `lingui:extract`
re-adds our strings (empty), copy msgid -> msgstr, but ONLY for msgids that are
absent from upstream/main's catalog for that locale (i.e. ours), so upstream's
own untranslated entries are left exactly as upstream has them.

usage: seed-po.py <upstream-ref>      (run from the repo root)
"""
import glob, os, subprocess, sys
import polib

ref = sys.argv[1]
base = 'fluxer_app/src/features/i18n/locales'
total = 0
for path in sorted(glob.glob(f'{base}/*/messages.po')):
    loc = path.split('/')[-2]
    if loc == 'en':
        continue
    up = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
    upstream_ids = {e.msgid for e in polib.pofile(up.stdout)} if up.returncode == 0 else set()
    po = polib.pofile(path, wrapwidth=0)
    n = 0
    for e in po:
        if e.obsolete or not e.msgid or e.msgid in upstream_ids:
            continue
        if e.msgid_plural:
            if not any(e.msgstr_plural.values()):
                e.msgstr_plural = {i: (e.msgid if i == 0 else e.msgid_plural) for i in e.msgstr_plural or {0: '', 1: ''}}
                n += 1
        elif not e.msgstr:
            e.msgstr = e.msgid
            n += 1
    if n:
        po.save(path)
    total += n
print(f'seeded {total} fork strings across non-en catalogs')
