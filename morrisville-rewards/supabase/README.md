# Database (Supabase / Postgres)

Applied, in order, to project `pingpod-morrisville` (ref `apojuerjhvyzjmpanqih`). Run them in this
order on a fresh project; never edit a file that has already been applied — add a new one.

| File | Contents |
| --- | --- |
| `migrations/20261119000100_core.sql` | Tables (`venues`, `pilot_settings`, `profiles`, `play_sessions`, `crews`, `crew_memberships`, `spindex_ratings`, `support_requests`, `rewards`; `private.admins`, `admin_claim_codes`, `audit_log`, `rate_events`, `blocked_terms`), row-level security (own rows only), grants, helpers, auto-close of abandoned timers, `played_on` trigger, realtime broadcast triggers |
| `migrations/20261119000200_player_functions.sql` | Player functions: profile, timer (start/check-in/stop/cancel), log past play, crews, SPINDEX claims, requests to staff, account deletion |
| `migrations/20261119000300_boards_and_stats.sql` | Leaderboards (minutes/longest/streaks/SPINDEX; `p_scope` verified/community), crew board, `get_my_crew`, `get_me`, stats, achievements, iPad `get_display_data` |
| `migrations/20261119000400_admin.sql` | Staff functions (session adjust/reject/reopen, players, crews, SPINDEX verification, requests, settings, rewards, staff, audit log, analytics, CSV exports), one-time staff codes, EXECUTE lockdown, `pg_cron` cleanup job |
| `migrations/20261119000500_crew_attribution_by_end.sql` | Crew credit by session **end** time (`private.in_membership`); replaces `crew_board`, `get_my_crew`, `weekly_stats` |
| `migrations/20261119000600_manual_end_not_in_future.sql` | Logged-past-play sessions never end after the moment they're logged |
| `migrations/20261119000700_timing_refinements.sql` | "Today" logs end now; timer too-short cutoff fixed at 5 min |
| `migrations/20261119000800_fk_indexes.sql` | Foreign-key indexes (performance advisor) |
| `migrations/20261119000900_trust_players.sql` | Sessions count immediately (trigger `private.count_immediately`; no approval step), boards default to `community` scope, "Verified" milestone replaced by "Regular" (5 different days) |

`schema.sql` (if present) is the concatenation of the migrations for one-shot setup in the SQL editor.

Function reference: [`../docs/API.md`](../docs/API.md). Production setup: [`../docs/SETUP.md`](../docs/SETUP.md).

## Tests

- `../tests/integration.test.mjs` — signs in as real test accounts over the Supabase HTTP API and
  exercises the acceptance flows (timer, manual logs, crews across two accounts, staff session fixes,
  privacy opt-out, SPINDEX labels, security checks). Needs the env vars documented at the top of
  the file (project URL, publishable key, test-account password, a one-time staff code). Test
  accounts are created with SQL beforehand and should be deleted afterwards — they would otherwise
  appear on public boards.
- `tests/time_logic.sql` (this folder) — run in the SQL editor (or via the Supabase MCP / `psql`) as the
  `postgres` role. Simulates signed-in players by setting `request.jwt.claims` and switching to the
  `authenticated` role, back-dates timestamps to test auto-close, minute calculation and crew
  attribution, and rolls everything back at the end.

Run the app's unit tests with `npm test` from `morrisville-rewards/`.
