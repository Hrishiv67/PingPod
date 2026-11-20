# Backend API reference

Everything a client can do goes through Postgres functions (RPCs) in the `public` schema of the
Supabase project `pingpod-morrisville`. The web app and any native app call the **same**
functions, so rules (limits, crews, rankings) can't drift between clients.

- Source of truth: [`supabase/migrations/`](../supabase/migrations) (files `…0100` → `…0900`).
- Call over HTTPS as `POST /rest/v1/rpc/<name>` with a JSON body of named args, or use a Supabase SDK
  (`supabase.rpc('name', { p_arg: … })` / `supabase.rpc("name", params: …)`).
- Errors are raised as Postgres exceptions whose **message is written for players** (for example
  "That nickname is taken. Try another."). Show `error.message` directly.
- Who can call: **anon** = no login (iPad display, invite preview) · **player** = any signed-in
  account · **staff** = row in `private.admins` · **owner** = staff with role `owner`.

## Conventions

| Topic | Rule |
| --- | --- |
| Time | All timestamps are server time (`timestamptz`). Clients never send start times. |
| Calendar | Week = Monday 00:00 → Sunday in `America/New_York`. `played_on` is the Morrisville date. |
| Periods | `week` (this Monday), `month` (1st of this month), `all`. |
| Counting | Players' timed and logged minutes count immediately (no approval step, migration 0009). Staff can adjust, reject (remove) or reopen a session. |
| Scope (advanced) | Board functions still take `p_scope`: `community` = everything not rejected (approved + pending), `verified` = approved only. Since sessions are approved automatically these are effectively the same; clients should just pass the `default_board_scope` setting (`community`) and not show a toggle. |
| Crew credit | A session counts for the crew you belonged to **when it ended**: `ended_at > joined_at` and (`left_at` is null or `ended_at <= left_at`). Joining a crew never brings old history with you; no session counts twice. |
| Idempotency | `start_session` and `log_session` accept `p_client_request_id` (UUID). Retrying with the same id returns the original row. `stop_session` on an already-stopped session returns it unchanged. |

### Session status lifecycle

```
start_session ──► active ──stop_session──► approved (counts immediately)
                    ├──cancel_session──► cancelled
                    ├──stop under 5 min──► cancelled (flag too_short)
                    └──still running after max (default 180 min)──► approved, capped (flag auto_closed)
log_session ──────────────────────────────► approved (counts immediately)
approved ──staff reject (reason)──► rejected (removed from all totals)
approved ──staff adjust (reason)──► approved with new minutes
approved / rejected ──staff reopen (reason)──► pending ──staff approve──► approved
```

A database trigger (`private.count_immediately`) turns any new or just-finished session into
`approved`. `pending` now only happens when staff reopen a session.

Flags on a session: `auto_closed` (timer was abandoned and closed at the max), `hit_max`
(player stopped it at/after the max), `same_day_as_timer` (manual entry on a day that already has a
timer session — possible duplicate), `too_short` (timer stopped before the minimum; not counted).

### Tie-breaks (deterministic; ranks are unique positions)

| Board | Order |
| --- | --- |
| minutes | value ↓, whoever reached it first (earlier last counted session end) ↑, nickname (A→Z), id |
| longest | minutes ↓, earlier session ↑, nickname, id |
| streaks | current streak ↓, longest streak ↓, total minutes ↓, nickname, id |
| spindex | rating ↓, verified before self-reported, earlier claim ↑, nickname, id |
| crews | minutes ↓, whoever reached it first ↑, crew name, id |

Streak = consecutive days (Morrisville calendar) with at least one counted session. The current
streak stays alive through today if the player played yesterday; it resets after a full missed day.

Public boards exclude players with `show_on_leaderboard = false` or `hidden_by_admin = true`
(SPINDEX also requires `show_spindex = true`). Crews appear once they have at least
`crew_min_size` active members and are not hidden or archived.

## Sign-in (email only)

Players never choose a password. Clients derive one from the email and use Supabase's normal
email + password sign-in:

```
key = "Pp!" + first 40 hex chars of SHA-256(lowercase(trim(email)) + "|pingpod-morrisville-email-only-v1") + "9"
1. auth.signInWithPassword(email, key)      → signed in
2. if "Invalid login credentials": auth.signUp(email, key) → new account, signed in
3. if signUp says "already registered": it's a staff account (staff keep their own password).
   Show a password field and sign in with it. Players never get here: every player account,
   including ones made before email-only sign-in, is on the key (migration 20261119001300).
```

Anyone who knows a player's email can open that player's account — an accepted trade-off for the
pilot. Staff and owner roles only work once the account has a real password (checked in the
database by `private.on_email_key`), so the derived key never opens staff tools.

## Player functions

| Function | Args | Returns | Who |
| --- | --- | --- | --- |
| `get_me` | — | jsonb: `server_now`, `profile` (null until a nickname is chosen), `admin_role` (owner·staff·null; null until a staff account has its own password), `staff_needs_password` (on the staff list but still email-only), `active_session`, `crew` {id,name,invite_code,is_owner}, `spindex` {id,rating,status,source,verified_at,created_at}, `stats` (below), `settings` (pilot_settings row). Also closes the caller's abandoned timer. | player |
| `save_profile` | `p_display_name`, `p_avatar_color`='pink' (pink·white·blue·green·orange·purple), `p_show_on_leaderboard`=true, `p_show_spindex`=true | `profiles` row | player |
| `start_session` | `p_client_request_id` uuid? | `play_sessions` row (status `active`) | player with profile |
| `checkin_session` | `p_id` | row (sets `last_checkin_at`) | owner of session |
| `stop_session` | `p_id`, `p_ended_at` timestamptz? (accepted only if within the last 30 min, never future) | row (`approved`, or `cancelled` if under 5 min) | owner of session |
| `cancel_session` | `p_id` | row (`cancelled`, 0 min) | owner of session |
| `log_session` | `p_played_on` date, `p_minutes` int, `p_note` text?, `p_client_request_id` uuid? | row (`manual`, `approved`) | player with profile |
| `get_my_achievements` | — | table: `code, title, description, target, progress, earned_at`. Codes: `first_session, first_hour, minutes_300, minutes_600, minutes_1200, long_session, streak_3` (3 days in a row), `streak_7` (7 days in a row), `crew_joined, regular` (5 different days), `weekly_top5`. | player |
| `create_crew` | `p_name` (3–24 chars) | `crews` row | player with profile |
| `preview_crew` | `p_code` | jsonb {name, members, max_members} or null | anon |
| `join_crew` | `p_code` | `crews` row (same crew → returns it) | player with profile |
| `leave_crew` | — | void (owner leaving → oldest member becomes owner; last member → crew archived) | player |
| `rename_crew` | `p_name` | `crews` row | crew owner |
| `regenerate_crew_code` | — | `crews` row (new invite code) | crew owner |
| `transfer_crew` | `p_user_id` | void | crew owner |
| `remove_crew_member` | `p_user_id` | void | crew owner |
| `get_my_crew` | `p_period`='week', `p_scope`='verified' | jsonb: id, name, invite_code, is_owner, created_at, hidden_by_admin, min_members, max_members, rank, crews_ranked, total_minutes, members[] {user_id, display_name, avatar_color, is_owner, is_me, joined_at, minutes} — or null | player |
| `submit_spindex` | `p_rating` 0–3000, `p_note`? | `spindex_ratings` row (`self_reported`, `unverified`; previous claim superseded) | player with profile |
| `remove_spindex` | — | void | player |
| `submit_request` | `p_kind` correction·privacy·deletion·other, `p_message` (≤600), `p_session_id`? (must be own) | `support_requests` row | player |
| `delete_my_account` | — | void (deletes auth user + all their rows; leaves crew first) | player |
| `admin_claim` | `p_code` | jsonb {role} — one-time staff code | player |

`stats` keys: `week_verified, week_pending, month_verified, month_pending, total_verified,
total_pending, sessions, pending_sessions, longest_session, current_streak, longest_streak,
rank_week_verified, rank_week_community, ranked_week_verified, ranked_week_community` (personal
streaks count pending + approved; ranks are null when not ranked or opted out). With no approval
step, `*_pending` values are normally 0 — clients can show `*_verified + *_pending` as one total.

### Profiles, photos, crew look

| Function | Args | Returns | Who |
| --- | --- | --- | --- |
| `save_bio` | `p_bio` text (≤140, null clears) | `profiles` row | player with profile |
| `set_avatar` | `p_path` text — `<user id>/<name>.jpg` already uploaded to the public `avatars` bucket; null removes | `profiles` row | player with profile |
| `get_player_card` | `p_user_id` | jsonb: `user_id, display_name, avatar_color, avatar_path, bio, member_since, is_me, crew{name,color,emblem,motto}, week_minutes, total_minutes, sessions, current_streak, longest_streak, rank_week, spindex{rating,verified}` (players hidden from boards are only visible to crewmates) | player |
| `set_crew_style` | `p_color` (avatar colors), `p_motto` (≤60, optional), `p_emblem` users·flame·bolt·crown·target·rocket·star·shield | `crews` row | crew owner |
| `remove_my_session` | `p_id` | row (`cancelled`, reason "Removed by player"; stops counting everywhere) | owner of session |

Photos: upload with Supabase Storage to bucket `avatars`, path `<auth user id>/<anything>.jpg` (players can only
write their own folder; max 512 KB; jpeg/png/webp), then call `set_avatar`. Public URL:
`<project url>/storage/v1/object/public/avatars/<avatar_path>`. The web app resizes to a 320×320 JPEG first.
`get_leaderboard`, `get_my_crew` members and `get_display_data` rows include `avatar_path`;
`get_crew_leaderboard`, `preview_crew` and display `crews[]` include `color, emblem, motto`.
Staff: `admin_moderate_player` actions `clear_photo`, `clear_bio`; `admin_moderate_crew` action `clear_motto`.

## Public boards (anon + player)

| Function | Args | Returns |
| --- | --- | --- |
| `get_leaderboard` | `p_metric` minutes·streaks·longest·spindex, `p_period` week·month·all (ignored for streaks/spindex but must be valid), `p_scope` verified·community, `p_limit`=50 (1–200) | table: `rank, user_id, display_name, avatar_color, value, secondary, sessions, detail, is_me`. The caller's own row is always included even if outside the limit. `secondary` = longest streak (streaks). `detail` = session date (longest) or `verified`/`self_reported` (spindex). |
| `get_crew_leaderboard` | `p_period`, `p_scope`, `p_limit`=50 | table: `rank, crew_id, name, minutes, members, contributors, avg_minutes, is_mine` |
| `get_display_data` | — | jsonb for the iPad: `generated_at, scope, rotation_seconds, slides, public_app_url, venue_name, week_start, minutes[], longest[], streaks[], spindex[], crews[], highlights{players, minutes, sessions, new_players, longest, most_sessions, top_crew, top_spindex, active_crews}`. Nicknames only — no ids, emails or notes. |

Realtime: every change to sessions, profiles, crews, memberships or ratings sends a **broadcast**
on public channel `leaderboard`, event `changed`, payload `{at}` (no data). Clients refetch the
board; also poll (30–60 s) as a fallback.

## Staff functions (all audited in `private.audit_log`)

| Function | Args | Returns | Who |
| --- | --- | --- | --- |
| `admin_list_sessions` | `p_status`='pending' (pending·approved·rejected·cancelled·active·all), `p_search`?, `p_limit`=200 | jsonb[] incl. nickname, flags, note, is_own, player_sessions, player_rejections | staff |
| `admin_review_session` | `p_id`, `p_action` approve·reject·adjust·reopen, `p_minutes`?, `p_reason`? | row. Rules: can't change your own session; approve only applies to a reopened (pending) session; changing minutes, rejecting an approved session, adjust and reopen all require a reason. | staff |
| `admin_bulk_approve` | `p_ids` uuid[] | int approved (skips own and non-pending; only relevant for reopened sessions) | staff |
| `admin_list_players` | `p_search`? (nickname or email) | jsonb[] incl. email, totals, crew, SPINDEX, admin_role | staff |
| `admin_moderate_player` | `p_user_id`, `p_action` hide·unhide·rename, `p_value`?, `p_reason`? | void | staff |
| `admin_delete_player` | `p_user_id`, `p_reason` | void (not self, not staff) | owner |
| `admin_list_crews` | — | jsonb[] incl. members, past_members, week_verified_minutes | staff |
| `admin_moderate_crew` | `p_crew_id`, `p_action` rename·hide·unhide·archive·transfer·remove_member, `p_value`? (name or user id), `p_reason`? | void | staff |
| `admin_list_spindex` | `p_status`='unverified' (unverified·verified·rejected·all) | jsonb[] | staff |
| `admin_review_spindex` | `p_id`, `p_action` verify·reject·unverify, `p_source` (required to verify) | void (not your own) | staff |
| `admin_list_requests` | `p_status`='open' (open·resolved·dismissed·all) | jsonb[] | staff |
| `admin_resolve_request` | `p_id`, `p_status` resolved·dismissed·open, `p_response`? | void | staff |
| `admin_update_settings` | `p_patch` jsonb (any subset of settings below) | `pilot_settings` row | owner |
| `admin_list_rewards` | — | `rewards` rows | staff |
| `admin_save_reward` | `p_id`? (null = new), `p_title`, `p_description`, `p_criteria`, `p_enabled`, `p_approval_note` (≥5 chars required to enable) | `rewards` row | owner |
| `admin_list_staff` | — | jsonb[] {user_id, role, added_at, display_name, email} | staff |
| `admin_set_staff` | `p_user_id`, `p_role` owner·staff·null (null removes) | void (can't change yourself) | owner |
| `admin_audit_log` | `p_limit`=200 | jsonb[] | staff |
| `admin_analytics` | — | jsonb: accounts, registered_players, players_with_session, repeat_players_days, repeat_players_weeks, sessions{…}, minutes{…}, crews{…}, spindex{…}, open_requests, weekly[] | staff |
| `admin_export` | `p_kind` weekly·players·sessions | jsonb[] (players/sessions use pseudonymous `player_ref`; no names, emails or notes) | staff |

## Tables a client may read directly (row-level security)

| Table | anon | player |
| --- | --- | --- |
| `pilot_settings`, `venues` | all rows | all rows |
| `rewards` | only `enabled` rewards, and only when `rewards_enabled` is on | same |
| `profiles`, `play_sessions`, `crew_memberships`, `spindex_ratings`, `support_requests` | — | **own rows only** |
| `crews` | — | the crew you're currently in |

No client has INSERT/UPDATE/DELETE on any table. Staff tables (`admins`, `audit_log`,
`admin_claim_codes`, `rate_events`, `blocked_terms`) live in the `private` schema, which the API
does not expose.

## Pilot settings (`pilot_settings`, single row)

| Field | Default | Allowed |
| --- | --- | --- |
| `venue_name` | PingPod Morrisville | text |
| `public_app_url` | https://pingpod-morrisville-rewards.vercel.app | http(s) URL — used for the join QR |
| `pilot_start`, `pilot_end` | null | dates (analytics window) |
| `max_session_minutes` | 180 | 30–480 (timer cap / auto-close) |
| `checkin_reminder_minutes` | 90 | 15–240 |
| `manual_min_minutes` | 5 | 1–60 (timers under 5 min, or this value if lower, aren't counted) |
| `manual_max_minutes` | 180 | 15–480, > min |
| `backdate_days` | 7 | 0–60 |
| `daily_minutes_cap` | 300 | 30–720 (all sessions on one day) |
| `crew_min_size` / `crew_max_size` | 2 / 8 | 1–10 / 2–30, min ≤ max |
| `auto_approve_timer` | false | boolean — no effect since migration 0009 (sessions always count) |
| `default_board_scope`, `display_scope` | community | verified·community (see Scope above) |
| `display_rotation_seconds` | 15 | 8–60 |
| `survey_url` | the "after" Google Form | https link shown once to new players and on the profile; null = off (no player data is added to the link) |
| `display_slides` | minutes, spindex, crews, streaks, longest, highlights | subset of those (≥1); the iPad always shows them in this order |
| `boards_enabled` | minutes, streaks, longest, spindex, crews | subset of those |
| `rewards_enabled` | false | boolean (master switch for physical rewards) |

## Built-in limits (server-side)

| Action | Limit |
| --- | --- |
| Start timer | 12 / hour |
| Log past play | 6 / hour; same day + same minutes = duplicate; daily cap; not future; within `backdate_days`; no logging while a timer runs |
| Create crew | 3 / day · Join crew 6 / day · Rename crew 5 / day |
| Nickname change | 5 / day |
| SPINDEX submissions | 5 / day |
| Requests to staff | 5 / day |
| Staff code attempts | 1 s delay per failed attempt |
| Abandoned timers | closed every 10 min by `pg_cron` job `pingpod-close-stale-sessions` (and on the player's next `get_me`/`start_session`) |
