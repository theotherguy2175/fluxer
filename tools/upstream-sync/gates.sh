#!/usr/bin/env bash
# Cheap static gates for the fork-specific things an upstream merge has silently
# lost or broken before while typecheck and tests stayed green. Run from the
# repo root after a merge. Exits non-zero listing every failed gate.
set -uo pipefail
fail=0
bad() { echo "GATE FAIL: $*"; fail=1; }

# 1. our audit-log entries (upstream deleted the legacy list they used to live in, #2798)
v=packages/schema/src/primitives/AuditLogValidators.ts
for a in POLL_END SOUNDBOARD_SOUND_CREATE SOUNDBOARD_SOUND_UPDATE SOUNDBOARD_SOUND_DELETE; do
  grep -q "'$a'" "$v" || bad "audit log action $a missing from $v"
done

# 2. our permission bits must still be unique (a collision silently grants the wrong right)
c=packages/constants/src/ChannelConstants.ts
for pair in "USE_SOUNDBOARD:42" "SEND_POLLS:49"; do
  name=${pair%:*} bit=${pair#*:}
  grep -q "$name: 1n << ${bit}n" "$c" || bad "$name is no longer bit $bit"
  n=$(grep -c "1n << ${bit}n" "$c")
  [ "$n" = 1 ] || bad "bit $bit used $n times in $c (collision with upstream?)"
done

# 3. worker lanes: no task in two lanes (JetStream rejects overlapping filter_subjects),
#    and our expirePolls task must still be registered
python3 - <<'PY' || fail=1
import re, collections, sys
s = open('fluxer_api/src/api/worker/WorkerLaneConfig.ts').read()
tasks = []
for m in re.finditer(r"\btasks:\s*\[(.*?)\]", s, re.S):
    tasks += re.findall(r"'([^']+)'", m.group(1))
dup = [t for t, n in collections.Counter(tasks).items() if n > 1]
ok = True
if dup: print("GATE FAIL: task(s) in more than one worker lane:", dup); ok = False
if 'expirePolls' not in tasks: print("GATE FAIL: expirePolls no longer in any worker lane"); ok = False
sys.exit(0 if ok else 1)
PY

[ $fail = 0 ] && echo "all fork gates passed"
exit $fail
