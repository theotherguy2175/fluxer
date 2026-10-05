#!/usr/bin/env python3
"""Hunk-level resolution of a merge in progress: auto-accept upstream wherever the
fork's soundboard/polls work is not involved.

For every conflicted text file, each conflict hunk is classified by OUR side:
  - ours side mentions soundboard/poll/entrance-sound terms -> feature hunk
  - otherwise                                               -> take THEIRS (upstream)
Feature hunks are only auto-resolved in the i18n error-string catalogs, where
CLAUDE.md documents the rule: take upstream, keep only our `polls.*` /
`soundboard_sounds.*` entries (appended after upstream's lines). Any other
feature hunk leaves the file untouched and is reported as manual.

Prints one line per file:  RESOLVED <path> | MANUAL <path> (n feature hunks)
Exit 0 always; the caller reads MANUAL lines.
usage: resolve-conflicts.py            (run from the repo root, mid-merge)
"""
import re
import subprocess
import sys

TERMS = re.compile(r'soundboard|poll|entrance[_ -]?sound', re.I)
CATALOG = re.compile(r'^(packages/errors/src/i18n/locales/|weblate/|packages/errors/.*weblate)')
KEEP = re.compile(r"(^|['\"\s])(polls|soundboard_sounds)[._]|soundboard|poll", re.I)


def unmerged():
    out = subprocess.run(['git', 'diff', '--name-only', '--diff-filter=U'], capture_output=True, text=True).stdout
    return [l for l in out.split('\n') if l]


def resolve(path):
    try:
        text = open(path, encoding='utf-8').read()
    except (UnicodeDecodeError, FileNotFoundError):
        return None, 0
    lines = text.split('\n')
    out, i, feature = [], 0, 0
    while i < len(lines):
        if not lines[i].startswith('<<<<<<< '):
            out.append(lines[i]); i += 1; continue
        ours, theirs, base, cur = [], [], [], ours
        i += 1
        while i < len(lines) and not lines[i].startswith('>>>>>>> '):
            if lines[i].startswith('||||||| '):
                cur = base
            elif lines[i] == '=======':
                cur = theirs
            else:
                cur.append(lines[i])
            i += 1
        i += 1  # >>>>>>>
        if not any(TERMS.search(l) for l in ours):
            out += theirs
        elif CATALOG.match(path):
            have = set(theirs)
            out += theirs + [l for l in ours if KEEP.search(l) and l not in have]
        else:
            feature += 1
            out += ['<<<<<<< ours'] + ours + ['======='] + theirs + ['>>>>>>> theirs']
    return '\n'.join(out), feature


for p in unmerged():
    new, feature = resolve(p)
    if new is None:
        print(f'MANUAL {p} (binary/deleted)')
    elif feature:
        print(f'MANUAL {p} ({feature} feature hunks)')
    else:
        open(p, 'w', encoding='utf-8').write(new)
        subprocess.run(['git', 'add', p], check=True)
        print(f'RESOLVED {p}')
