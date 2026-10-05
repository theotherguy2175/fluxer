#!/usr/bin/env bash
# Try to merge upstream/main into a new feature/upstream-merge-<date> branch off
# origin/main and, if it comes out clean AND passes the fork gates, push it
# (the push triggers soundboard-images, which builds the images the cluster-side
# promoter then proves on dev).
#
# Auto-resolves ONLY what CLAUDE.md documents as mechanical:
#   *.po catalogs  -> take upstream, re-extract, re-seed our strings
#   .gitignore     -> keep ours (CLAUDE.md is tracked in the fork)
# Any other conflicted path stops the run and is reported. Never pushes main.
#
# Always exits 0 on a "normal" outcome and reports through $GITHUB_OUTPUT:
#   status = uptodate | inflight | conflict | gates | pushed
#   branch, report (path of a markdown report for the issue body)
set -euo pipefail

OUT=${GITHUB_OUTPUT:-/dev/null}
REPORT=${REPORT:-${RUNNER_TEMP:-/tmp}/sync-report.md}
BASE=${BASE:-origin/main}
here=$(cd "$(dirname "$0")" && pwd)
out() { echo "$1=$2" >> "$OUT"; }
finish() { out status "$1"; out report "$REPORT"; echo "sync: $1"; exit 0; }

git fetch -q upstream main
up=$(git rev-parse upstream/main); up7=${up:0:7}
out upstream_sha "$up7"

if git merge-base --is-ancestor "$up" "$BASE"; then finish uptodate; fi
# a human (or an earlier run) already merged this upstream commit on a branch
if [ -z "${SKIP_INFLIGHT:-}" ] && git branch -r --contains "$up" | grep -q "origin/feature/"; then finish inflight; fi

branch=${BRANCH:-feature/upstream-merge-$(date -u +%F)}
out branch "$branch"
git checkout -q -B "$branch" "$BASE"
n=$(git rev-list --count "$BASE..$up")

set +e
git merge --no-ff --no-commit upstream/main >/dev/null 2>&1
set -e

# 1. generated files: take upstream, regenerate below
regen_openapi=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    *messages.po)                 git checkout --theirs -- "$f" 2>/dev/null && git add "$f" ;;
    .gitignore)                   git checkout --ours   -- "$f" 2>/dev/null && git add "$f" ;;  # CLAUDE.md is tracked in the fork
    *openapi*.json)               git checkout --theirs -- "$f" 2>/dev/null && git add "$f" && regen_openapi=1 ;;
  esac
done < <(git diff --name-only --diff-filter=U)

# 2. everything else, hunk by hunk: upstream wins unless the fork's soundboard/polls
#    work is in the hunk (see resolve-conflicts.py); those files stay conflicted
resolved_log=$(python3 "$here/resolve-conflicts.py")
echo "$resolved_log"
manual=$(git diff --name-only --diff-filter=U)
[ -n "$manual" ] && manual=$(grep '^MANUAL' <<<"$resolved_log" | sed 's/^MANUAL //')$'\n'

if [ -n "$manual" ]; then
  {
    echo "Merging upstream \`$up7\` ($n commits) into \`$BASE\` conflicts in files that are not mechanical:"
    echo; echo '```'; printf '%s' "$manual"; echo '```'
    echo; echo "Follow the merge playbook in CLAUDE.md (\"Merging upstream into the fork\"). Once a \`feature/**\` branch containing \`$up7\` is pushed, the cluster promoter picks it up from there."
  } > "$REPORT"
  git merge --abort || true
  finish conflict
fi

# i18n: regenerate catalogs and seed our strings into non-English locales, even
# when the merge was textually clean (a clean merge can still leave raw
# {placeholders} in prod).
CI=true pnpm install --frozen-lockfile
[ "$regen_openapi" = 1 ] && pnpm openapi:generate && git add -A
( cd fluxer_app && pnpm lingui:extract )
python3 "$here/seed-po.py" upstream/main
git add -A fluxer_app/src/features/i18n
# compiled locale modules (packages/errors, @fluxer/i18n) are generated from the
# catalogs: left stale they fail upstream's i18n drift check and ship old strings
pnpm i18n:compile
cargo fmt --all
git add -A

if ! bash "$here/gates.sh" > "$REPORT.gates" 2>&1; then
  {
    echo "Upstream \`$up7\` ($n commits) merged textually, but a fork gate failed, so nothing was pushed:"
    echo; echo '```'; cat "$REPORT.gates"; echo '```'
    echo; echo "These are the silent losses typecheck and tests do not catch; see CLAUDE.md."
  } > "$REPORT"
  git merge --abort 2>/dev/null || git reset -q --hard "$BASE"
  finish gates
fi

git commit -q -m "Merge upstream/main ($up7, $(date -u +%F)) into the fork [automated]

$n upstream commits. Mechanical conflicts auto-resolved (.po -> upstream +
re-extract + re-seed fork strings; .gitignore -> ours). Fork gates passed."
if [ -z "${NO_PUSH:-}" ]; then git push -q origin "$branch"; fi
echo "Pushed \`$branch\`: upstream \`$up7\` ($n commits) merged cleanly and passed the fork gates." > "$REPORT"
finish pushed
