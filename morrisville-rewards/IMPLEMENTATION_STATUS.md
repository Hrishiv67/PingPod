# Implementation status

_Last updated: 2026-11-19 · branch `morrisville-rewards-starter` · app in `morrisville-rewards/`_

## How to resume (read this first)

1. `cd morrisville-rewards && npm install && npm run dev` (demo mode without `.env.local`).
2. Backend: Supabase project **pingpod-morrisville** (ref `apojuerjhvyzjmpanqih`, us-east-1, free plan). Migrations 0100–0900 in `supabase/migrations/` are applied. New DB work = new numbered migration + re-run the grant/revoke block (see README).
3. Frontend data access goes only through `src/lib/api.ts` (`api.*`). Types: `src/lib/types.ts`. Rules live in SQL, not React.
4. Product decision (Nov 19): **players' time counts immediately**. There's no approval queue, and staff only fix or remove mistakes. Don't reintroduce verification UI unless the pilot owner asks.
5. A native Swift app is planned on the same backend. Keep RPC names and signatures stable, and document changes in `docs/API.md` and `docs/SWIFT_INTEGRATION.md`.

## Done and tested

| Area | Status | How it was tested |
| --- | --- | --- |
| Schema, RLS, permissions, rate limits, audit log | Done | Live API suite (RLS, denied writes, anon limits); Supabase security advisor |
| Email-only sign-in for every player (no password, no confirmation email; accounts made with a password earlier were switched in the database), persistent login, sign out, delete account; staff keep a real password enforced in the database | Done | Live browser E2E (sign in, reload, sign out persists); API suite (deletion) |
| Nickname onboarding, avatar color, leaderboard opt-in, privacy toggles | Done | Browser E2E + API suite (case-insensitive uniqueness, blocked words) |
| Server-timed sessions: start/finish/cancel, one active, idempotent retries, offline finish queue, 90-min check-in, 3-hour auto-stop | Done | API suite; rollback SQL time-logic test (DST, clamping, auto-close); browser E2E (timer restored after reload, 54-min finish) |
| Log past play (7-day backdate, 5–180 min, duplicate + daily-cap checks) | Done | API suite; browser E2E (duplicate rejected with message) |
| Leaderboards: minutes (week/month/all), SPINDEX (second tab), crews, daily streaks, longest session; deterministic tie-breaks | Done | API suite; browser E2E (two devices see the same board) |
| Crews: create, invite link/code, join, leave, rename, transfer, remove, new code; membership-history attribution | Done | Browser E2E (2 phones, combined 114 min); API suite; SQL boundary tests |
| Milestones (10, derived from activity) | Done | API suite; demo tests |
| SPINDEX: self-reported by default, staff can verify with a note; never computed or imported | Done | API suite; browser E2E ("Self-reported SPINDEX" label) |
| Staff dashboard `/admin`: sessions (adjust/reject/reopen), players, crews, SPINDEX, requests, rewards (off by default), settings, analytics + CSV, audit log, staff | Done | Browser E2E (claim code, pending→approve flow before the trust change, analytics render); typecheck/build |
| iPad display `/display` (+ `/?display=1`): rotating slides, QR, realtime + 30 s polling, offline indicator, wake lock | Done | Browser E2E (updated live without reload; opt-out removed player live; no emails in HTML) |
| Printable QR poster `/poster` (letter + table cards) | Done | Playwright PDF render |
| iPhone layout (SE → Pro Max): safe areas, no horizontal scroll, ≥40 px targets | Done | Playwright walkthrough at iPhone SE + 15 Pro Max |
| Demo mode with labeled sample players | Done | 11 demo-rule unit tests |

Latest results (2026-11-19): `npm test` 22/22 pass · `tsc` clean · `npm run build` clean (no warnings) · live API suite 17/17 pass · rollback-only SQL time-logic test 18/18 pass · live browser E2E (2 phones + staff + iPad) passed · iPhone SE / 15 Pro Max walkthrough with no overflow or errors · production smoke test of `/`, `/join/*`, `/display`, `/poster` passed. Test accounts were removed afterwards; the live database starts empty.

## UX refinement pass (2026-11-19)
- Welcome: one email field and **Continue** ("No password needed"). Streaks are daily (days in a row; 3- and 7-day milestones).
- Profiles: photo (resized on the phone, public `avatars` bucket, staff can remove) and a short bio; tap any player on the
  leaderboard or in a crew for their profile card. Crews: owner picks color, emblem and motto (shown on boards and the iPad).
  Players can remove one of their own sessions. A little more spacing, less repeated text, and the PingPod logo loader
  wherever something loads. Live check: logging updates the iPad instantly; last week's minutes drop off the weekly board.
- Photo crop (drag to move, pinch/slider to zoom, round preview) before upload. Leaderboard is a full numbered list (no
  podium) with a "where you stand" card: your rank of everyone, the gap to the next spot up, and Find me. Same for crews.
- Research survey: new players see a one-time "Quick favor?" card on Home linking to an anonymous Google Form (nothing about
  the player is added to the link); it stays as "Research survey" on the profile. Owners change or clear the link in
  Admin → Settings → Research survey (`pilot_settings.survey_url`).
- Home: Start playing / Log past session first, one compact stats strip, recent sessions; the active timer has its own focused view.
- Less repeated grey text on Rankings, Crew and Me.
- iPad `/display`: back to the original layout (large QR panel beside the board) by request. Six boards rotate: most minutes, highest SPINDEX (second, by request; verified ratings marked), crew rankings, daily streaks, longest session and this week. Category-specific labels and units, pilot dates in the header, an invitation row under short lists, and each empty board shows its own message.
- `/admin`: Sessions · Players · Crews · Stats · Settings, with the rest under More; plain labels; staff notes are optional.
- Tested: demo walkthrough at iPhone SE/14/Pro Max/desktop, display states at iPad portrait/landscape/TV, admin against mocked data, and a live two-phone + iPad run on the real database (test accounts deleted afterwards). Not yet tested: admin against live data, physical devices.

## Needs live configuration (owner action)

1. ~~Turn off "Confirm email" in Supabase~~ — done; sign-up is instant.
2. Supabase → Authentication → URL Configuration: Site URL `https://pingpod-morrisville-rewards.vercel.app`, Redirect URLs `https://pingpod-morrisville-rewards.vercel.app/**` and `http://localhost:5173/**`.
3. Optional: custom SMTP (Gmail app password) so "Forgot password" emails reach players. See `docs/SETUP.md`.
4. Claim owner access: sign up, open `/admin`, enter the one-time owner code (given privately, expires 2026-12-19). Then add Joe from Admin → Players → Make owner.
5. Pilot dates are preset to **Mon Nov 23 – Sun Dec 20, 2026**. Change them in Admin → Settings.

## Known limitations / deferred

- No proof of physical attendance; minutes are player-reported or timed in the app (by design for this pilot).
- No PodPlay / SPINDEX / booking integration (no authorized API). The `spindex_ratings.source` column has an `official_integration` value reserved for a future authorized sync.
- Physical rewards are built but **off** until Joe approves terms (an approval note is required to enable one).
- Optional match XP (+20/+60/+10) is not built (deferred by request).
- No push notifications; the 90-minute check-in shows in the app only.
- Swift integration guide was written but not compiled here (no Xcode in this environment).
- Not tested on a physical iPhone/iPad; tested in Playwright's iPhone/iPad emulation.
