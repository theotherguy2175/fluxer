# Fluxer + Soundboard (fork)

This is a fork of [fluxerapp/fluxer](https://github.com/fluxerapp/fluxer) that
adds a **community soundboard**: members upload short clips, and anyone in a
voice channel can trigger them so everyone in the channel hears it. Upstream
declined to merge it, so it lives here as a maintained patch on top of
upstream `main`.

- Branch: **`main`** — upstream `main` plus the soundboard commits on top
- Images: `ghcr.io/theotherguy2175/fluxer-{api,gateway,media-proxy,app-proxy-self-hosted}`
- Everything else in a Fluxer deployment is unchanged and keeps using upstream's images
- Upstream's own README continues below this section

## What you get

- **Community settings → Soundboard** tab: upload (`mp3` / `ogg` / `m4a` / `wav`,
  ≤ 512 KB, 0.1–5 s by default), rename, pick an emoji, set per-sound volume, delete
- **Soundboard button in the voice bar**: plays the clip for everyone in the
  channel (each client plays it locally in sync — nothing is mixed into LiveKit,
  so it works with voice/video exactly as before)
- New permission **Use Soundboard** (bit 42) to play sounds, granted to
  `@everyone` on new communities by default. Uploading and editing your own
  sounds needs **Create Expressions**; editing or deleting anyone's needs
  **Manage Expressions**; the community-level soundboard settings need
  **Manage Community** — the same split as emojis and stickers
- Audit log entries for create / update / delete
- Instance limits: `max_soundboard_sounds_per_guild` (default 9, ceiling 200) and
  `max_soundboard_sound_duration_ms` (default 5000, ceiling 30000), adjustable per
  plan/community like the other limits

## Run it: existing Docker Compose install

If you installed Fluxer with upstream's `install.sh`, you already have the
compose stack. Three steps:

```sh
cd <your fluxer directory>          # the one holding docker-compose.yml and .env

# 1. add the overlay file next to docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/theotherguy2175/fluxer/main/deploy/self-hosting/docker-compose.soundboard.yml

# 2. enable it in .env (append it after any overlay you already list)
#    COMPOSE_FILE=docker-compose.yml:docker-compose.soundboard.yml
#    COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml:docker-compose.soundboard.yml
echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.soundboard.yml' >> .env

# 3. pull and recreate the four affected services
docker compose pull
docker compose up -d
```

Then, **once**, grant *Use Soundboard* to `@everyone` on communities that already
existed (new communities get it automatically):

```sh
curl -fsSL https://raw.githubusercontent.com/theotherguy2175/fluxer/main/fluxer_api/scripts/backfill-use-soundboard-permission.sql \
  | docker compose exec -T postgres psql -U fluxer -d fluxer
docker compose restart api gateway     # drop cached role permissions
```

The script is idempotent. Skip it if you'd rather hand the permission out per
role in each community's settings.

Two optional `.env` knobs, both default to a published build:

| variable | default | meaning |
|---|---|---|
| `SOUNDBOARD_REGISTRY` | `ghcr.io/theotherguy2175` | where the four images come from |
| `SOUNDBOARD_IMAGE_TAG` | `soundboard` | moving tag = latest build; pin to an `sb-YYYYMMDD-xxxxxxx` tag for reproducibility |

`FLUXER_IMAGE_TAG` keeps controlling the other seven images as usual.

**Compatibility:** each soundboard build is made from upstream `main` at the
commit in its tag, and the seven upstream images you run alongside it should be
from around the same date. Running `v1` (upstream's moving tag) for the rest is
what we do ourselves; if upstream ever changes an internal NATS contract,
rebuild from a fresh upstream merge (see below) rather than pinning the seven back.

## Run it: new install

Install upstream Fluxer first with their installer (see *Self-hosting* in the
upstream README below / [docs.fluxer.app](https://docs.fluxer.app)), confirm it
works, then follow the *existing install* steps above. The backfill isn't
needed for communities created after the overlay is in place.

## Run it: Kubernetes

There's no chart; the compose file translates to plain manifests one-for-one.
With kustomize, swap the four images and leave the rest:

```yaml
images:
  - name: ghcr.io/fluxerapp/fluxer-api
    newName: ghcr.io/theotherguy2175/fluxer-api
    newTag: sb-20260915-fa1cf92
  - name: ghcr.io/fluxerapp/fluxer-gateway
    newName: ghcr.io/theotherguy2175/fluxer-gateway
    newTag: sb-20260915-fa1cf92
  - name: ghcr.io/fluxerapp/fluxer-media-proxy
    newName: ghcr.io/theotherguy2175/fluxer-media-proxy
    newTag: sb-20260915-fa1cf92
  - name: ghcr.io/fluxerapp/fluxer-app-proxy-self-hosted
    newName: ghcr.io/theotherguy2175/fluxer-app-proxy-self-hosted
    newTag: sb-20260915-fa1cf92
```

Bump all four together; they're built from one commit. Run the same backfill SQL
against your Postgres (`kubectl exec -i deploy/postgres -- psql -U fluxer -d fluxer < …`)
and restart `api` + `gateway`.

Note that current upstream requires `FLUXER_ERLANG_COOKIE` in the gateway's
environment (any random string). Compose installs get it from `.env`; if your
manifests predate that, add it or the gateway exits at start with
`FLUXER_ERLANG_COOKIE is required.`

## Build the images yourself

The images are built from **upstream's unmodified Dockerfiles** — the fork
changes source, not packaging. Two ways:

**GitHub Actions** (`.github/workflows/soundboard-images.yaml`): runs on every
push to `main` and on *Run workflow*. Builds `linux/amd64` +
`linux/arm64` on native runners, merges a manifest per image, and pushes to
`ghcr.io/<repo owner>/…` with tags `sb-<YYYYMMDD>-<sha7>` and `soundboard`.
If you fork this fork, it works unchanged with no secrets — but GHCR packages
created by a workflow start **private**; make each of the four public once
under *Packages → package → Package settings → Change visibility*, or give your
cluster an `imagePullSecret`.

**Locally** (`tools/soundboard/build-images.sh`): same images, same args.

```sh
tools/soundboard/build-images.sh --push                                   # ghcr.io/theotherguy2175, amd64
tools/soundboard/build-images.sh --push --registry ghcr.io/you            # your registry
tools/soundboard/build-images.sh --push --platform linux/amd64,linux/arm64
tools/soundboard/build-images.sh --only api,app-proxy --push              # subset
tools/soundboard/build-images.sh                                          # no push, --load into local docker
```

`docker login` to the target registry first. Cross-building amd64 from an
Apple Silicon machine works via emulation but takes ~10 minutes each for
`api` and `app-proxy`.

## Keeping up with upstream

`main` here is upstream `main` plus the soundboard commits. Bring in upstream
changes with a merge (not a rebase — `main` is public, and rewriting it would
break everyone who cloned it):

```sh
git remote add upstream https://github.com/fluxerapp/fluxer.git   # once
git config rerere.enabled true                                     # once; replays past conflict resolutions
git fetch upstream
git checkout main
git merge upstream/main
# resolve conflicts if any, then:
pnpm install --frozen-lockfile
(cd fluxer_api && pnpm typecheck)
(cd fluxer_app && pnpm typecheck)
(cd fluxer_app && pnpm vitest run src/features/guild/utils/guild_tabs/audit_log)
git push origin main                                               # triggers the image build
```

Files the soundboard touches that upstream also edits regularly (so conflicts
tend to land here): `fluxer_api/src/api/middleware/ServiceSingletons.ts`,
`fluxer_api/src/api/types/HonoEnv.ts`, `fluxer_api/src/api/guild/controllers/index.ts`,
`packages/schema/src/primitives/AuditLogValidators.ts`, the audit-log presenter
map, and the entrance-sound service the soundboard reuses. Everything else the
feature adds is in new files under `*/soundboard/`.

To see the soundboard as a single patch against upstream at any time:
`git diff upstream/main...main -- . ':!README.md' ':!deploy/self-hosting/docker-compose.soundboard.yml' ':!tools/soundboard' ':!.github/workflows/soundboard-images.yaml'`

## Layout of the change

| area | what |
|---|---|
| `packages/constants`, `packages/schema`, `packages/errors`, `packages/limits` | permission bit, limits, request/response schemas, audit-log action types |
| `fluxer_api/src/api/guild/soundboard/` | repository, service, play service, controllers |
| `fluxer_api/scripts/backfill-use-soundboard-permission.sql` | one-time permission grant for existing communities |
| `fluxer_gateway/src/utils/event_atoms.erl` | `SOUNDBOARD_SOUND_PLAY` / `SOUNDBOARD_SOUNDS_UPDATE` gateway events |
| `fluxer_media_proxy/src/server/` | serves `soundboard-sounds/…` from the CDN bucket |
| `fluxer_app/src/features/guild/…/GuildSoundboardTab.tsx`, `fluxer_app/src/features/voice/components/Soundboard*.tsx` | settings tab, voice-bar menu, upload modal |
| `deploy/self-hosting/docker-compose.soundboard.yml` | compose overlay |
| `.github/workflows/soundboard-images.yaml`, `tools/soundboard/build-images.sh` | image builds |

Storage is additive (new `guild_soundboard_*` tables / KV keys); there is no
migration and nothing upstream reads changes shape, so rolling back is
switching the four images back to upstream's.

---

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./fluxer_static/marketing/branding/logo-white.svg">
    <img src="./fluxer_static/marketing/branding/logo-color.svg" alt="Fluxer logo" width="400">
  </picture>
</p>

<p align="center">
  <a href="https://fluxer.app/donate">
    <img src="https://img.shields.io/badge/Donate-fluxer.app%2Fdonate-brightgreen" alt="Donate" /></a>
  <a href="https://docs.fluxer.app">
    <img src="https://img.shields.io/badge/Docs-docs.fluxer.app-blue" alt="Documentation" /></a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-AGPLv3-purple" alt="AGPLv3 License" /></a>
</p>

# Fluxer

Fluxer is a free and open source instant messaging and VoIP chat app built for friends, groups, and communities.

<p align="center">
  <img src="./fluxer_static/marketing/screenshots/desktop-readme-1920w.png" alt="Fluxer app showcase" width="900">
</p>
