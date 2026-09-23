# Fluxer fork — dev workspace

This is a local clone of Cody's **fork** of `fluxerapp/fluxer`
(`theotherguy2175/fluxer`). It started as a workspace for building a
Discord-style soundboard; that shipped, and so did message polls, so the
job now is as much *keeping the fork current with upstream* as adding to
it. This file exists so a new Claude Code session opened here has full
context without re-deriving it — read it before doing anything else.

## Current state (2026-09-23)

The fork carries three things upstream does not: a **guild soundboard**,
**message polls**, and **per-user soundboard hotkeys**. `main` is the
release branch; upstream is taken in by **merge**, not rebase.

- Last upstream merge: `18c303abf` (2026-09-23), on branch
  `feature/upstream-merge-2026-09-23`. 82 upstream commits.
- Prod (`fluxer` ns) runs `sb-20260916-b7bd210`. Dev (`fluxer-dev` ns)
  runs `sb-20260923-1d3bb42` — i.e. dev is one upstream merge ahead of
  prod, which is the point of having it.
- The fork is a **public** GitHub repo. Nothing secret belongs in it,
  including in this file.

Upstream will not take this work: `.github/LLM_USAGE_POLICY.md` forbids
LLM-authored contributions from non-write-access contributors. This fork
runs on Cody's instance indefinitely; it is not a PR staging area.

Remotes are already correctly configured (via `gh repo fork` + `gh repo
clone`, which wires this up automatically):
- `origin` → `https://github.com/theotherguy2175/fluxer.git` (the fork —
  push branches here)
- `upstream` → `https://github.com/fluxerapp/fluxer.git` (read-only,
  pull/rebase from here to stay current with upstream)

**Dev environment decision: native host, not the VS Code devcontainer.**
Cody chose to install the toolchain (Rust, Node+pnpm, Erlang/OTP) directly
on macOS rather than using `.devcontainer/`, specifically so Claude Code
can run build/test/dev commands directly via a normal terminal — same
workflow as every other project in this session — with no container
boundary to reason about. The devcontainer config still exists in the repo
and is one valid option (see "Getting the dev environment running" below)
but is *not* the path being used here.

**Origin session** (all the research/reasoning behind this plan happened
here — worth reading if something below is unclear or you need the *why*):
https://claude.ai/code/session_01P2fetEHxtdPmKS2r9ubBCb

## How this project came to exist

Cody self-hosts Fluxer (an open-source Discord-like chat app) on his
homelab Kubernetes cluster at `fluxer.casteel.pw`. That deployment lives in
a **separate repo**: `~/gitprojects/ArgoDeploy` — `apps/fluxer` is prod
(ArgoCD-synced) and `apps-dev/fluxer-dev` is the dev clone, applied by
hand (the path was `apps-dev/fluxer/` when this file was first written; it
moved when prod went under ArgoCD) (GitOps
repo, manifests translated from `fluxerapp/fluxer`'s official
`deploy/self-hosting/docker-compose.yml`). That repo's own `README.md`
documents a handful of real compose-vs-k8s translation bugs we hit and
fixed getting it running — worth a skim if you ever need to understand how
production is actually configured, since some of it differs slightly from
upstream's own defaults (notably: `app-proxy`'s `FLUXER_STATIC_CDN_ENDPOINT`
had to be unset because upstream's own default value creates a
self-referencing request loop that blanks the entire frontend — a real bug
in their reference compose file, not a k8s-specific issue).

**This repo here is unrelated to that deployment.** It's a plain local dev
clone for building a new feature. Nothing here should touch the production
cluster directly — if/when the feature is ready to try live, that's a
deliberate, separate step (build a container image, update the ArgoDeploy
manifests, same as any other image bump).

## The goal: a Discord-style soundboard

Feature request: let guild members upload short sound clips and trigger them
on demand in a voice channel, so everyone currently in the channel hears it
— like Discord's soundboard.

### Key finding: don't build this from scratch — extend the existing "entrance sounds" feature

Fluxer already has a near-identical feature called **entrance sounds** (a
short clip that plays when a user joins a voice channel). Its plumbing is
almost exactly what a soundboard needs:

- Upload/validate/store a short audio clip (trim UI, duration/size limits,
  format validation)
- An API endpoint to "play this clip in this voice channel"
- A realtime gateway event that broadcasts the trigger to everyone
  currently in that channel

**Important architectural detail** (this changes the whole scope estimate):
entrance sounds do **not** get mixed into the actual LiveKit/WebRTC audio
stream server-side. The gateway just broadcasts an `ENTRANCE_SOUND_PLAY`
event over the existing realtime WebSocket, and each connected client
independently fetches and plays the audio file locally. It's a "tell every
client to play this locally, in sync" pattern, not real server-side audio
mixing.

This means there are two very different versions of this feature:

1. **"Lite" soundboard (do this one)**: reuse the entrance-sound pattern
   almost directly — a guild-scoped sound library instead of per-user, a
   trigger endpoint, a new gateway event, a grid-button UI panel instead of
   a settings-page picker. Most of the hard infrastructure (upload,
   storage, rate limiting, permissions, realtime dispatch) already exists
   in an adjacent, copyable form. This is a moderate-effort build.
2. **True Discord-parity soundboard** (out of scope for now): sound is
   actually mixed into the live voice audio via a server-side LiveKit
   participant/agent publishing an audio track into the room. Real
   voice-infra engineering (LiveKit Agents/Ingress APIs), meaningfully
   harder, and not what we're building first.

### Exact files to study as the template (entrance sounds)

Backend (TypeScript, `fluxer_api`):
- `fluxer_api/src/api/user/entrance_sound/EntranceSoundService.ts` — core
  upload/validation logic (format, duration probe, size limits)
- `fluxer_api/src/api/user/entrance_sound/EntranceSoundController.ts` —
  REST routes (list/upload/delete), rate-limited, login-required
- `fluxer_api/src/api/user/entrance_sound/EntranceSoundPlayService.ts` —
  the "play this in channel X" logic, validates sender is actually in the
  channel
- `fluxer_api/src/api/user/entrance_sound/EntranceSoundPlayController.ts` —
  the `POST /voice/channels/:channel_id/entrance-sound` route
- `fluxer_api/src/api/user/entrance_sound/EntranceSoundRepository.ts` — DB
  access (Cassandra in this file, but note: Cody's self-hosted instance
  runs the **Postgres** backend via the generic KV table abstraction —
  check `fluxer_svc`/`fluxer_common` for how the KV layer abstracts over
  both backends before assuming Cassandra-specific code applies)
- `fluxer_api/src/api/user/entrance_sound/EntranceSoundDurationProbe.ts` —
  shells out to ffprobe-equivalent to validate clip duration
- `fluxer_api/src/api/rate_limit_configs/UserRateLimitConfig.ts` — see
  `USER_ENTRANCE_SOUND_LIST` etc. for the rate-limit pattern to copy
- `fluxer_api/src/api/Tables.ts` — `USER_ENTRANCE_SOUND_COLUMNS`,
  `USER_ENTRANCE_SOUND_SELECTION_COLUMNS`
- `packages/constants/src/EntranceSoundConstants.ts` — the actual limits:
  `ENTRANCE_SOUND_MAX_PER_USER = 8`, `ENTRANCE_SOUND_MAX_BYTES = 1MB`,
  `ENTRANCE_SOUND_MAX_DURATION_MS = 5200`, `MIN_DURATION_MS = 100`,
  `NAME_MAX_LENGTH = 32` — use similar numbers for a soundboard, maybe
  scoped per-guild instead of per-user

Storage/serving (Rust, `fluxer_media_proxy`):
- `fluxer_media_proxy/src/server/asset_path.rs` —
  `parse_entrance_sound_path` shows the URL-path convention for serving
  these clips back out
- `fluxer_media_proxy/src/server/routes/dispatch.rs` — wires that parser
  into the routing table

Realtime (Erlang, `fluxer_gateway`):
- `fluxer_gateway/src/utils/event_atoms.erl` — `ENTRANCE_SOUND_PLAY` atom
  mapping; a soundboard needs a new event here (e.g.
  `SOUNDBOARD_SOUND_PLAY`)
- `fluxer_api/src/api/constants/Gateway.ts` — TypeScript-side event type
  list, needs the new event added here too

Client (TypeScript/React, `fluxer_app`):
- `fluxer_app/src/features/voice/components/EntranceSoundTrimmerModal.tsx`
  — the record/trim UI (uses `AudioWavEncode` util) — directly reusable for
  a soundboard upload flow
- `fluxer_app/src/features/notification/utils/EntranceSoundScopes.ts` —
  shows the global/guilds/dms scoping pattern; a soundboard would probably
  be guild-scoped only (more like custom emoji/stickers than entrance
  sounds)
- `fluxer_app/src/features/ui/action_menu/items/VoiceParticipantMenuItems.tsx`
  and `VoiceParticipantMenuData.tsx` — shows how entrance-sound controls
  hook into the voice UI's context menus; a soundboard needs its own
  panel/button in the voice channel UI instead
- `fluxer_app/src/features/app/constants/Endpoints.ts` — see
  `USER_ENTRANCE_SOUNDS`, `VOICE_CHANNEL_ENTRANCE_SOUND` for the endpoint
  constant pattern

### Suggested build order

1. Read all the files above first — don't start writing code until the
   entrance-sound flow (upload → store → list → trigger → gateway
   broadcast → client plays) is fully understood end to end.
2. Backend: new `fluxer_api/src/api/guild/soundboard/` module mirroring the
   entrance_sound structure (guild-scoped instead of user-scoped: list,
   upload, delete, play).
3. Add the new gateway event atom + TS type.
4. Client: new soundboard panel component (grid of sound buttons) +
   reuse `EntranceSoundTrimmerModal`'s recording/trimming logic for upload.
5. Wire permissions (who can add sounds to a guild, who can trigger them —
   look at how other guild-scoped features like custom emoji gate this).
6. Test locally via the devcontainer (see below) before ever touching the
   production cluster.

## Getting the dev environment running

**Chosen path: native host, no devcontainer.** Install the toolchain
directly on macOS:
- Rust: `rustup` (rustup.rs) — check `Cargo.toml`/`rust-toolchain.toml` for
  any pinned version once you're in there
- Node.js + pnpm: via Homebrew/nvm, then `corepack enable` or
  `npm i -g pnpm` — check `package.json`'s `packageManager` field for the
  exact pnpm version expected
- Erlang/OTP (for `fluxer_gateway`): `brew install erlang` — BEAM/OTP
  version mismatches can cause subtle build issues, so if something in
  `fluxer_gateway` fails to compile, check `fluxer_gateway`'s own
  `rebar.config`/`.tool-versions`-equivalent for the version it expects
  before assuming it's a code bug
- Docker Desktop (already installed and working on this machine, confirmed
  earlier this session) — needed for the infra services (Postgres, Valkey,
  NATS, LiveKit, Meilisearch), managed via the `fluxer-dev` CLI below, not
  via `.devcontainer/`

There's a first-party Rust-based dev CLI (`fluxer-dev`, source in
`tools/dev/src/`) invoked via pnpm scripts — check `package.json` for the
full list, but the important ones:
- `pnpm dev:bootstrap` — first-time setup
- `pnpm dev:infra:start` / `dev:infra:stop` / `dev:infra:status` — manages
  the Docker-based service dependencies (Postgres/NATS/Valkey/etc.)
- `pnpm dev` — run everything
- `pnpm dev:services` — just the Rust microservices
- `pnpm test`, `pnpm typecheck`, `pnpm build`
- `pnpm dev:tunnel` — Cloudflare Tunnel integration for exposing local dev
  publicly, if ever needed

All three toolchains work natively on macOS — no cross-compilation needed
for local dev; that only matters later when building `linux/amd64` images
to actually deploy to the k8s cluster.

### Starting it (what actually works, 2026-09-15)

```sh
export PATH="/opt/homebrew/opt/erlang@27/bin:$PATH"     # OTP 27, not brew's default
source ~/.cargo/env
export CC_wasm32_unknown_unknown="$(brew --prefix llvm)/bin/clang"
export AR_wasm32_unknown_unknown="$(brew --prefix llvm)/bin/llvm-ar"
pnpm dev:infra:start          # Docker: postgres/nats/valkey/meilisearch/livekit/mailpit
pnpm dev                      # api :8080, gateway, worker, Rust services, app; proxy on :8088
```

- App: **http://localhost:8088**. Admin portal: http://localhost:8088/admin.
  Mailpit (all local email lands here): http://localhost:8025.
- Do **not** `source config/env/*.env` yourself — the dev CLI loads them, and
  sourcing through the shell mangles JSON-valued vars
  (`FLUXER_LIVEKIT_DEFAULT_REGION must be valid JSON` on api boot).
- If `pnpm dev` dies with `Gateway task exited with status 1` and rebar3 says
  `Uncaught error in rebar_core` / `binary_to_atom` badarg: the gitignored
  `fluxer_gateway/_build` was compiled by a different OTP. `rm -rf
  fluxer_gateway/_build` and rerun.
- Frontend edits hot-reload; api edits restart the api; a gateway edit needs
  `pnpm dev` restarted.

### Local accounts and test data (local Docker Postgres only)

| account | password | notes |
|---|---|---|
| `admin@admin.com` / `admin` | `Fluxer-Admin-Local1` | wildcard admin (`acls: ["*"]`), email marked verified, owns **Polls Test** |
| `pollsadmin@example.com` / `pollsadmin` | `c9Tq10S5yZdfN43P` | wildcard admin |
| `codydev@example.com` / `codydev` | (forgotten — reset via Mailpit) | first account, wildcard admin, owns **Soundboard Test** |

Communities: **Polls Test** (guild `1549525586471288832`, `#general`
`1549525586471288835`, permanent invite code **`ctibyyyo`**) and
**Soundboard Test**. Registration is open locally, so extra voters are one
signup away (private window → `/register` → then `/invite/ctibyyyo`).

Recreating an admin from scratch (registration API + DB, ~10 s):

```sh
# 1. register — password rules: 8–256 chars AND not on the common-password list
#    ("admin", "adminadmin", "password1" are all rejected)
curl -s -X POST http://localhost:8088/api/v1/auth/register \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8088' \
  -d '{"email":"admin@admin.com","username":"admin","global_name":"Admin","password":"Fluxer-Admin-Local1","date_of_birth":"1990-01-01","consent":true}'
# 2. wildcard admin ACL + verified email (creating a community requires a
#    verified email, and Mailpit is the only place the mail goes)
docker exec fluxer-dev-postgres-1 psql -U fluxer -d fluxer -c "
  update fluxer_kv set row_data = jsonb_set(jsonb_set(jsonb_set(row_data,
      '{acls}', '{\"value\":[\"*\"],\"__fluxer_type\":\"set\"}'::jsonb),
      '{email_verified}', 'true'::jsonb),
      '{version}', to_jsonb(coalesce((row_data->>'version')::int,0)+1)),
    updated_at = now()
  where table_name='users' and row_data->>'username'='admin';"
# 3. community + permanent invite (login first: POST /auth/login {email,password} -> token)
curl -s -X POST http://localhost:8088/api/v1/guilds -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8088' -H "Authorization: $TOKEN" -d '{"name":"Polls Test"}'
curl -s -X POST http://localhost:8088/api/v1/channels/<general channel id>/invites \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8088' -H "Authorization: $TOKEN" \
  -d '{"max_age":0,"max_uses":0}'
```

The storage backend locally is the same Postgres `fluxer_kv` jsonb table as
prod, so any row can be inspected/patched with `docker exec
fluxer-dev-postgres-1 psql -U fluxer -d fluxer`.

### Native-host gotchas actually hit while building the soundboard feature

The tooling was clearly written assuming it always runs inside the
devcontainer's Docker network. Getting it working from a bare macOS
terminal required these fixes (all one-time, all local-only — nothing
here is checked into the tracked `.envrc`):

1. **`erl` must be OTP 27, not whatever `brew install erlang` gives you
   today (OTP 29).** The vendored `ezstd` NIF dependency's `c_src/nif.mk`
   generates `env.mk` via `erl -noshell -s init stop -eval "file:write_file(...)"`
   — note `-s init stop` comes *before* `-eval` on the command line. On
   OTP 29 `init:stop()` now wins the race and halts the VM before the
   eval's file write completes, so `rebar3 compile` always fails with
   `env.mk: No such file or directory`. Fix: `brew install erlang@27`
   (keg-only, doesn't touch the default `erlang` link) and prepend
   `/opt/homebrew/opt/erlang@27/bin` to `PATH` before running any
   `fluxer_gateway` rebar3/pnpm command. Also make sure `~/.cargo/env` is
   sourced first — `rebar3 compile` shells out to `cargo` for a couple of
   NIF crates (`native/push_markdown_plaintext_nif`,
   `native/guild_member_list_oset_nif`) and fails with `cargo: not found`
   otherwise.
2. **Docker Compose service DNS names (`postgres`, `valkey`, `nats`,
   `livekit`, `meilisearch`, `mailpit`) don't resolve from the bare host**
   — they only resolve inside the devcontainer's Docker network, but
   `tools/dev/src/{bootstrap,main,manifest,tasks}.rs` hardcode those
   literal hostnames in several places (not just env-var driven), so
   overriding `FLUXER_POSTGRES_HOST` etc. in `config/env/local.env` isn't
   enough on its own. Fix: add them to `/etc/hosts` pointing at
   `127.0.0.1` (needs `sudo`, ask the user to run it):
   ```
   127.0.0.1 postgres
   127.0.0.1 valkey
   127.0.0.1 nats
   127.0.0.1 livekit
   127.0.0.1 meilisearch
   127.0.0.1 mailpit
   ```
   `config/env/local.env` still needs `COMPOSE_PROJECT_NAME=fluxer-dev`
   (the `fluxer-dev` CLI's `infra start/stop` requires it when run from
   the host, since it can't infer the devcontainer's Compose project
   label). The infra containers themselves aren't created by `fluxer-dev
   infra start` on a first run either — that subcommand only does
   `docker compose start` (resumes existing containers), not `up`. First
   time only: `docker compose --project-name fluxer-dev -f
   .devcontainer/docker-compose.yml up -d postgres valkey nats livekit
   meilisearch mailpit` (deliberately omitting the `workspace` service —
   that's the devcontainer itself, not needed here).
3. **`fluxer_media_proxy`'s native image/audio deps aren't all on
   Homebrew.** `brew install vips ffmpeg` (>=8.0, for `libavformat`)
   covers most of it, but **`libyuv` has no Homebrew formula** despite
   `fluxer_media_proxy/tools/install-native-deps.sh` and `build.rs`
   assuming `brew install libyuv` works. Built it from source instead:
   `git clone https://chromium.googlesource.com/libyuv/libyuv`, then
   `cmake -S . -B build -DCMAKE_INSTALL_PREFIX=/opt/homebrew
   -DLIBYUV_DISABLE_JPEG=ON && cmake --build build -j8 && cmake --install
   build`. `pkgconf` (provides `pkg-config`) also needed installing
   explicitly — `brew install pkgconf`.
4. **`fluxer_app`'s `pnpm typecheck` needs a wasm32-capable clang.** The
   `wasm:codegen` step (`tools/ci/run.sh build-app-wasm`) compiles a Rust
   crate to `wasm32-unknown-unknown`, which pulls in `zstd-sys` — Xcode's
   bundled clang has no wasm32 backend, so the C compile fails. Fix:
   `brew install llvm` (full LLVM, not Xcode's), `rustup target add
   wasm32-unknown-unknown`, then set
   `CC_wasm32_unknown_unknown="$(brew --prefix llvm)/bin/clang"` and
   `AR_wasm32_unknown_unknown="$(brew --prefix llvm)/bin/llvm-ar"` before
   running `pnpm typecheck`/`pnpm dev` in `fluxer_app`. First run also
   does a one-time `cargo install wasm-bindgen-cli` — expect it to take a
   few minutes.

None of this needed any changes to the tracked `.envrc` or
`docker-compose.yml` — it's all either `/etc/hosts`, `config/env/local.env`
(gitignored), or Homebrew packages installed once on this machine.

### Important: pre-existing upstream soundboard scaffolding — don't clobber it

While building this, `pnpm typecheck` surfaced a collision: **upstream
already has a handful of tiny soundboard-related fragments committed** in
the fork's history (landed via `42cdc1f8 "fix(app): backport rendering
improvements (#1580)"`, apparently swept in incidentally from Hampus's own
unreleased work — the commit's stated purpose is unrelated). I initially
overwrote one of these files without checking first
(`packages/constants/src/SoundboardConstants.ts` — my `Write` replaced a
pre-existing single-line export). Fixed by merging both: the file now
keeps upstream's `SOUNDBOARD_SOUND_PATH_PREFIX` export alongside the new
constants this feature added, and the backend service imports that shared
constant instead of duplicating the literal.

**Full inventory of pre-existing fragments** (as of 2026-09-04, before this
feature's own work): `packages/constants/src/SoundboardConstants.ts`
(`SOUNDBOARD_SOUND_PATH_PREFIX`), `fluxer_app/src/features/user/utils/AvatarUtils.ts`
(`getSoundboardSoundURL(soundId)` — builds
`${SOUNDBOARD_SOUND_PATH_PREFIX}/${soundId}`, i.e. an **id-only** URL with
no hash/extension/guild segment — genuinely unused, zero call sites), and
a full keybind wiring: `voice_toggle_soundboard` action (Ctrl/Shift+B,
registered in `InputKeybind.ts`, handled in
`keybind_manager/handlers/defaultHandlers.ts` by dispatching
`ComponentBus.dispatch('SOUNDBOARD_TOGGLE')`), the `'SOUNDBOARD_TOGGLE'`
`ComponentActionType` in `ComponentBus.ts`, and a translated keybind label
("Toggle the soundboard") already in every locale catalog. None of the
actual panel/store/backend that keybind was meant to open existed before
this session.

**Deliberate deviation, not an oversight:** `getSoundboardSoundURL`'s
id-only URL shape implies upstream's real (unreleased) design serves
sounds keyed by id alone — closer to how emoji/stickers work
(`emojis/{id}`) than to entrance sounds. This feature instead mirrors the
entrance-sound pattern end-to-end as CLAUDE.md originally scoped it: sounds
are content-hashed and guild-scoped
(`soundboard-sounds/{guild_id}/{hash}.{ext}`, see
`GuildSoundboardService.cdnUrlFor`/`s3KeyFor` in `fluxer_api` and
`parse_soundboard_sound_path` in `fluxer_media_proxy`). That was a
deliberate call given only these two unused fragments were visible (not
the real upstream implementation) — don't "fix" this to match
`getSoundboardSoundURL` without first finding the actual upstream design.

**What this session did wire up to the pre-existing keybind**, since
leaving it a dead end would be a real regression: `VoiceControlBar.tsx`
subscribes to `ComponentBus`'s `'SOUNDBOARD_TOGGLE'` and opens/closes the
new `SoundboardMenu` popover anchored to the voice-bar soundboard button,
so Ctrl/Shift+B now does something.

**Before touching soundboard code in a future session**: `git grep -il
soundboard` across the repo first — if upstream ever lands the real
backport, it will very likely reuse these exact same names
(`SOUNDBOARD_SOUND_PATH_PREFIX`, `SOUNDBOARD_TOGGLE`, `voice_toggle_soundboard`)
and could conflict with what's built here.

**Alternative (not chosen, but documented in case it's ever worth
switching to):** `.devcontainer/devcontainer.json` gives guaranteed
toolchain-version parity with upstream's own CI, auto-bootstraps via
`postCreateCommand: cargo run -p fluxer-dev -- bootstrap`, and runs
`workspace, postgres, valkey, nats, livekit, meilisearch, mailpit` as
sibling containers (`mailpit` = fake SMTP catcher for local email testing).
If native toolchain versions ever cause unexplained build failures, this is
the fallback — but then Claude Code would need to run commands via
`docker exec` into the running devcontainer rather than a plain host
terminal, since the container has its own isolated toolchain.

A `fluxer_marketing` git submodule exists (README screenshots/branding
assets) but isn't initialized and isn't needed for feature work — skip it
unless something specifically requires it.

## Merging upstream into the fork

`main` is the release branch and upstream arrives by **merge** (`git
merge upstream/main`), never rebase — rebasing would rewrite the shipped
history the deployed image tags point at. `git rerere` is enabled, so
resolutions recorded once come back automatically next time.

Do the merge on a branch named `feature/<something>`. **The branch name
matters**: `.github/workflows/soundboard-images.yaml` only triggers on
`main` and `feature/**`, so a branch called anything else builds no
images and there is nothing to deploy.

### The conflicts that recur, and how they resolve

These are the same few places every time, because they are where our
features touch upstream's:

- **`fluxer_app/src/features/i18n/locales/*/messages.po` (~34 files).**
  Generated; never hand-merge. Take upstream's side wholesale (`git
  checkout --theirs`), then `cd fluxer_app && pnpm lingui:extract`, then
  **seed our strings into every non-English locale** by copying each
  empty `msgstr ""` from its `msgid`. Upstream fills these via Weblate;
  we have no translators, and an empty `msgstr` renders as a raw
  `{placeholder}` in prod. Expect ~130 fork strings per locale.
- **Worker lanes** (`WorkerLaneConfig.ts`, `WorkerMain.ts`,
  `WorkerTaskRegistry.ts`). Our `expirePolls` sits next to whatever
  upstream just added; keep both, alphabetically. Check afterwards that
  **no task name appears in two lanes** — lane task lists become
  JetStream `filter_subjects`, and overlapping subjects across consumers
  make the worker refuse to start.
- **`fluxer_media_proxy/src/server/routes/dispatch.rs`.** Our soundboard
  route lives in this dispatcher and upstream reworks it regularly (most
  recently into `serve_public_read` taking borrowed args). Re-express the
  `parse_soundboard_sound_path` block in whatever convention the
  neighbouring `parse_entrance_sound_path` block now uses.
- **Audit log.** See the trap below.

### Trap: our audit-log entries live in a list upstream keeps deleting

Upstream shipped the `guild_activity_log_presentation` experiment to
everyone (#2798) and deleted the entire legacy audit-log path with it:
`LEGACY_AUDIT_LOG_ACTIONS`, the `renderEntrySummary` renderer, and the
`shouldSuppressDetailsForAction` / `shouldHideChangeKey` helpers.

Our four entries (`POLL_END` + three `SOUNDBOARD_SOUND_*`) existed
**only** in the legacy list, so taking upstream's deletion silently drops
them from the activity-log filter dropdown — it still typechecks and all
tests still pass. They now live in `AUDIT_LOG_ACTIONS` in
`fluxer_app/src/features/app/config/AuditLogConstants.ts`.

The general lesson: after resolving, `biome check` the touched files and
treat every "unused variable" as a question — an orphaned descriptor
usually means a list entry of ours went missing with the block upstream
deleted.

### Verifying a merge before you build images

```bash
CI=true pnpm install --frozen-lockfile   # CI=true or it aborts: no TTY
pnpm typecheck                            # all 42 workspace packages
npx biome check fluxer_app/src fluxer_api/src packages
cargo check -p fluxer-media-proxy          # note: fluxer-media-proxy, with dashes
cd fluxer_api && npx vitest run && cd ../fluxer_app && npx vitest run
```

- `pnpm install` takes ~15 minutes after an upstream dependency bump. Do
  not pipe it to `tail` — the pipe masks a non-zero exit, and a network
  abort mid-install looks identical to success.
- **`fluxer_api/src/api/stripe/tests/StripeUtils.test.ts` fails locally
  and that is not your fault.** It builds dates with `new Date('2024-01-15')`
  (parsed as UTC) and asserts on `getDate()` (local), so all 18 cases
  fail in any timezone behind UTC. Run `TZ=UTC npx vitest run` to confirm
  before chasing it; CI runs in UTC and is green.
- MobX no longer uses `@action` decorators anywhere in
  `MessagingMessages.ts` (dropped in upstream's dependency upgrade).
  `makeAutoObservable` wraps methods anyway — don't reintroduce them.

## Deploying a merged build to dev

1. Push the `feature/**` branch; the images workflow builds four images
   (api, gateway, media-proxy, app-proxy-self-hosted) × two arches and
   tags them `sb-<YYYYMMDD>-<sha7>` plus a moving `branch-<name>`. ~15
   min. The other seven Fluxer images are unmodified by this fork and
   stay on upstream's `v1`.
2. Bump those four `newTag`s in `ArgoDeploy/apps-dev/fluxer-dev/kustomization.yaml`
   — that overlay's own `images:` block overrides the ones inherited from
   `apps/fluxer`, which is what keeps prod on its old tag.
3. `kubectl apply -k apps-dev/fluxer-dev/`. Prod is untouched: verify with
   `kubectl get pods -n fluxer -o jsonpath=...` before and after.

Things seen during a cold dev start (all self-resolving, don't panic):

- The dev stack is often scaled to **0 replicas** between uses; applying
  the overlay brings all 24 deployments back at once.
- When NATS starts cold, api/worker/shard services race to create the
  same durable JetStream consumers and lose with `Worker consumer
  workers_<lane> was replaced during startup`. Everything else settles
  after ~3 restarts; if the worker is still crashlooping once the rest
  are ready, `kubectl delete pod -l app=fluxer-worker` for one clean
  uncontested attempt.
- Image pulls to GHCR sometimes time out over IPv6 on `w-04`; kubelet
  retries and succeeds. Not an image problem — check whether another pod
  pulled the same registry on the same node before digging.
- Route smoke test (401 = route exists and is auth-gated, which is the
  pass condition; 404 = our code did not make it into the image):
  `curl -o /dev/null -w '%{http_code}' https://fluxer-dev.casteel.pw/api/v1/guilds/1/soundboard-sounds`

## Upstream facts worth knowing (as of 18c303abf)

- **Media proxy attachment signing and CORS gating** (`#2830`) only apply
  when `FLUXER_MEDIA_PROXY_ATTACHMENT_SIGNATURE_MODE` /
  `FLUXER_MEDIA_PROXY_CORS_MODE` are set; unset parses as `Off`. Signing
  covers `/attachments/` only, so soundboard sounds are unaffected. If
  CORS is ever turned on, `FLUXER_MEDIA_PROXY_CORS_ALLOWED_ORIGINS` must
  list the instance origin or audio fetches start failing.
- **Web push** (`#2906`) added a new `fluxer-push` container. Our k8s
  manifests have no such Deployment and our workflow doesn't build it, so
  push jobs go to NATS with no consumer. The gateway's own
  `gateway_http_push_profile_*` workers start fine and VAPID keys are
  already in `fluxer-secrets`; nothing errors, browser push just doesn't
  arrive. Adding it means a new Deployment plus a fifth built image.
- **The `recon` service was deleted upstream** (`#2808`). We never
  deployed it, so nothing to clean up.
- Permission bits: ours are `USE_SOUNDBOARD` (42) and `SEND_POLLS` (49).
  Upstream has left both free so far — re-check
  `packages/constants/src/ChannelConstants.ts` after each merge, since a
  collision would silently grant the wrong permission.

## Before you push anything

`origin` is the fork (`theotherguy2175/fluxer`) — push feature branches
there. `upstream` is `fluxerapp/fluxer`, read-only in practice: never push
there. `gh` CLI is authenticated as `theotherguy2175` on this machine (scopes:
gist, read:org, repo, workflow) if you need to open a PR later
(`gh pr create`) — though see the maintenance-context note below on why
that's not the near-term goal.

## Project maintenance context (worth knowing before planning a contribution)

Fluxer is currently maintained by **one person** (hampus-fluxer) — verified
directly, not assumed: the GitHub org has exactly 2 members (one with a
private/empty profile), the careers page says "We are not hiring," and the
maintainer's own pinned issue
([#1808](https://github.com/fluxerapp/fluxer/issues/1808)) states "there's
one person maintaining fluxerapp/fluxer, and that's me" and that **new PRs
are currently closed** because he can't review them fast enough while
stabilizing the app.

Practical implication: build this as a working feature for Cody's own
self-hosted instance first. Don't assume or plan around an upstream PR
being reviewed/merged in any predictable timeframe — treat that as a
possible future bonus, not the goal.

## Cluster access (only relevant once/if this gets deployed for real)

Cody's k8s cluster: `kubectl` context `admin@casteel-cluster`, namespace
`fluxer` for the live self-hosted instance. GitOps repo for that deployment:
`~/gitprojects/ArgoDeploy` (`apps-dev/fluxer/`, not wired into ArgoCD's
auto-sync — manual `kubectl apply` only, see that repo's own `README.md`
and `CLAUDE.md`). Don't touch that repo or cluster as part of this feature
build unless explicitly asked — this workspace is for local development
only.
