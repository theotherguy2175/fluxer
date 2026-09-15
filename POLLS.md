# Polls — design and build plan

Discord-style polls for Fluxer, built the same way as the soundboard: instance
limits an admin sets, community settings that can only tighten them, and no
changes to upstream's packaging. Branch `feature/polls`, on top of `main`
(= upstream main + soundboard).

## User-facing behaviour (Discord parity unless noted)

- A poll is part of a message: one **question**, 2–N **answers** (each with
  optional emoji), a **duration** (timer), and **allow multiple answers**.
- Created from the composer's "+" menu → *Create poll*. Sends a normal message
  (type `DEFAULT`) carrying a `poll` object; the message may also have text.
- Members vote by clicking answers; a vote can be changed or withdrawn while
  the poll is open. Results show per-answer counts and percentages; voters can
  be listed. Multiselect polls let a member pick several answers.
- The poll **ends** when the timer expires, or early when the author or
  someone with *Manage Messages* ends it. On ending, votes lock, the message
  is updated with `results.is_finalized = true`, and a `POLL_RESULT` system
  message replies to it announcing the winner (like Discord).
- Requires the new **Send Polls** permission (bit 49, granted to `@everyone`
  by default, backfilled for existing communities like `USE_SOUNDBOARD`).
  Voting needs the channel's read/react rights; ending early needs authorship
  or *Manage Messages*.
- Search: `has:poll` (upstream already indexes `hasPoll`; we set it).

## Limits (the part Cody asked for)

Instance limits, set by the admin under *Limit config* like the soundboard's
(keys in `packages/constants/src/LimitConfigMetadata.ts`, defaults in
`packages/limits/src/LimitDefaults.ts`), all `scope: guild`:

| limit key | default | ceiling | meaning |
|---|---|---|---|
| `feature_message_polls` | 1 | – | polls allowed on this instance |
| `max_poll_answers` | 10 | 25 | most answers one poll may have |
| `max_poll_question_length` | 300 | 1000 | characters |
| `max_poll_answer_length` | 55 | 200 | characters |
| `max_poll_duration_hours` | 768 (32 d) | 8760 (1 y) | longest timer |

Community settings (`guild_poll_settings`, edited under Community Settings →
**Polls**, needs *Manage Community*), each capped by the instance limit above
— the effective value is `min(community, instance)` exactly like
`GuildSoundboardService.getEffectiveLimits`:

`enabled`, `max_answers`, `max_question_length`, `max_answer_length`,
`max_duration_hours`, `default_duration_hours` (24), `allow_multiselect`.

Minimum duration is 1 hour; the composer offers 1 h / 4 h / 8 h / 24 h /
3 d / 1 w / 2 w plus custom, filtered to the effective maximum.

## Data model (additive — no changes to existing rows)

Two new KV/Cassandra tables in `fluxer_api/src/api/Tables.ts`, following the
soundboard's `defineTable` pattern:

- `message_polls` — partition `message_id`: `channel_id`, `guild_id?`,
  `author_id`, `question_text`, `answers` (list of `{answer_id, text, emoji_id?,
  emoji_name?}`), `allow_multiselect`, `layout_type`, `expires_at`,
  `finalized_at?`, `created_at`, `version`.
- `message_poll_votes` — partition `message_id`, clustering `answer_id, user_id`:
  `voted_at`. Counts are derived by scanning the partition (a poll's voters are
  bounded by the channel's membership; fine at self-hosted scale).
- `guild_poll_settings` — partition `guild_id`: the community settings above.

Messages get a new flag `MessageFlags.HAS_POLL = 1 << 14` so list fetches
know which messages need a poll lookup, mirroring `has_reaction`.

## API

- `POST /channels/:channel_id/messages` accepts `poll: {question: {text},
  answers: [{text, emoji?}], duration_hours, allow_multiselect}` alongside the
  existing fields. Validated against effective limits; sets `HAS_POLL`; stores
  the poll; the message response includes `poll`.
- `PUT /channels/:channel_id/polls/:message_id/answers/:answer_id/@me` vote,
  `DELETE …/@me` unvote (single-select: PUT replaces the previous vote).
- `GET /channels/:channel_id/polls/:message_id/answers/:answer_id` voters, paged.
- `POST /channels/:channel_id/polls/:message_id/expire` end early.
- `GET/PATCH /guilds/:guild_id/poll-settings` community settings.
- Gateway events (added to `fluxer_gateway/src/utils/event_atoms.erl` like the
  soundboard's): `MESSAGE_POLL_VOTE_ADD`, `MESSAGE_POLL_VOTE_REMOVE`
  (`{channel_id, message_id, guild_id?, user_id, answer_id}`), and a normal
  `MESSAGE_UPDATE` when a poll finalizes.
- Worker: `ExpirePolls` cron task (`fluxer_api/src/api/worker/`) finalizes
  polls past `expires_at`, sends the `POLL_RESULT` message, emits
  `MESSAGE_UPDATE`. Reads also finalize lazily if the worker is behind.
- Audit log: `POLL_END` (early end by a moderator) only; creation/voting is
  ordinary message activity.

## Client

- Composer "+" menu → *Create poll* modal (question, answers with emoji picker,
  duration select, multiselect toggle), respecting effective limits fetched
  from `poll-settings`.
- `MessagePoll` component in the message body: answers as buttons/bars,
  live counts via the gateway events, time remaining, "End poll" for
  author/managers, voters popout, finalized state.
- `POLL_RESULT` system message renderer.
- Community Settings → **Polls** tab (limits + toggles, with instance ceilings
  shown like the soundboard tab).
- `has:poll` search filter already exists in the UI.

## Build order

1. Shared: constants (flag, permission, message type, limits), limit metadata
   and defaults, schemas, error codes + i18n, permission labels.
2. API: tables, repository, poll service (validation, effective limits,
   vote, expire, finalize), settings service, controllers, message create
   integration, response serialization, gateway event names, search `hasPoll`.
3. Gateway: event atoms.
4. Worker: `ExpirePolls`.
5. Client: settings tab → composer modal → message renderer → gateway
   handlers → result message.
6. i18n: `pnpm lingui:extract` + seed the app catalogs; for the error
   catalogs (`packages/errors`) **translate** the new keys — the integrity
   test rejects English placeholders in non-English locales, and the compile
   step bakes English in for anything untranslated, so there is no passing
   "untranslated" state. (The soundboard's 9 error keys need the same; both
   are done together here.) Backfill SQL for `SEND_POLLS`; tests alongside
   the soundboard's.

## Deliberate non-goals for v1

No poll editing after send (Discord doesn't either), no anonymous polls
(voters are visible, as Discord), no image answers, no poll scheduling.
