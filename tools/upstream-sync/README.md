# upstream-sync

Daily merge of `fluxerapp/fluxer` main into a `feature/upstream-merge-<date>` branch
(`.github/workflows/upstream-sync.yaml`), verified by `fork-tests.yaml` and
`soundboard-images.yaml`, then picked up by the in-cluster promoter (ArgoDeploy
`apps-dev/fluxer-promoter`).

| file | what |
|---|---|
| `sync.sh` | orchestrates: merge, resolve, regenerate, gates, push |
| `resolve-conflicts.py` | hunk-level: take upstream unless the hunk involves soundboard/polls |
| `seed-po.py` | seed our strings into non-en catalogs (in place, stdlib only) |
| `gates.sh` | audit entries, permission bits 42/49, worker lanes |

Local dry run without pushing: `NO_PUSH=1 BRANCH=scratch/x SKIP_INFLIGHT=1 tools/upstream-sync/sync.sh`
(from a clean worktree; `origin` is the REAL fork, so NO_PUSH matters).

Repo prerequisites: secret `SYNC_DEPLOY_KEY` (private half of a write deploy key) and
"Allow GitHub Actions to create and approve pull requests" enabled.
