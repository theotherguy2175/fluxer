-- Backfill: grant SEND_POLLS to every existing community's @everyone role.
--
-- SEND_POLLS (permission bit 49) was introduced with the message polls
-- feature. Communities created before it do not have the bit on their
-- @everyone role, so members cannot create polls until it is
-- granted. Communities created afterwards receive it automatically through
-- DEFAULT_PERMISSIONS, so this script only needs to run once, at deploy time.
--
-- Usage:
--   psql "<api postgres connection string>" -f backfill-send-polls-permission.sql
--
-- Afterwards restart fluxer-api and fluxer-gateway so cached role permissions
-- are reloaded (or wait for the processes to cycle).
--
-- The @everyone role is stored as the guild_roles row whose role_id equals its
-- guild_id. Permission bit 49 == 2^49 == 562949953421312. The final AND clause
-- makes the statement idempotent — rows that already have the bit are skipped.

UPDATE fluxer_kv
SET row_data = jsonb_set(
      jsonb_set(
        row_data,
        '{permissions,value}',
        to_jsonb(((row_data -> 'permissions' ->> 'value')::bigint | 562949953421312)::text)
      ),
      '{version}',
      to_jsonb(COALESCE((row_data ->> 'version')::int, 0) + 1)
    ),
    updated_at = now()
WHERE table_name = 'guild_roles'
  AND row_data -> 'role_id' ->> 'value' = row_data -> 'guild_id' ->> 'value'
  AND ((row_data -> 'permissions' ->> 'value')::bigint & 562949953421312) = 0;
