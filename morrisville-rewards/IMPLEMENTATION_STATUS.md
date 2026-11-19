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
| Email + password accounts, persistent login, sign out, password change, delete account | Done | Live browser E2E (sign in, reload, sign out persists); API suite (deletion) |
| Nickname onboarding, avatar color, leaderboard opt-in, privacy toggles | Done | Browser E2E + API suite (case-insensitive uniqueness, blocked words) |
| Server-timed sessions: start/finish/cancel, one active, idempotent retries, offline finish queue, 90-min check-in, 3-hour auto-stop | Done | API suite; rollback SQL time-logic test (DST, clamping, auto-close); browser E2E (timer restored after reload, 54-min finish) |
| Log past play (7-day backdate, 5–180 min, duplicate + daily-cap checks) | Done | API suite; browser E2E (duplicate rejected with message) |
| Leaderboards: minutes (week/month/all), streaks, longest session, SPINDEX, crews; deterministic tie-breaks | Done | API suite; browser E2E (two devices see the same board) |
| Crews: create, invite link/code, join, leave, rename, transfer, remove, new code; membership-history attribution | Done | Browser E2E (2 phones, combined 114 min); API suite; SQL boundary tests |
| Milestones (10, derived from activity) | Done | API suite; demo tests |
| SPINDEX: self-reported by default, staff can verify with a note; never computed or imported | Done | API suite; browser E2E ("Self-reported SPINDEX" label) |
| Staff dashboard `/admin`: sessions (adjust/reject/reopen), players, crews, SPINDEX, requests, rewards (off by default), settings, analytics + CSV, audit log, staff | Done | Browser E2E (claim code, pending→approve flow before the trust change, analytics render); typecheck/build |
| iPad display `/display` (+ `/?display=1`): rotating slides, QR, realtime + 30 s polling, offline indicator, wake lock | Done | Browser E2E (updated live without reload; opt-out removed player live; no emails in HTML) |
| Printable QR poster `/poster` (letter + table cards) | Done | Playwright PDF render |
| iPhone layout (SE → Pro Max): safe areas, no horizontal scroll, ≥40 px targets | Done | Playwright walkthrough at iPhone SE + 15 Pro Max |
| Demo mode with labeled sample players | Done | 11 demo-rule unit tests |

Latest results (2026-11-19): `npm test` 22/22 pass · `tsc` clean · `npm run build` clean (no warnings) · live API suite 17/17 pass · rollback-only SQL time-logic test 18/18 pass · live browser E2E (2 phones + staff + iPad) passed · iPhone SE / 15 Pro Max walkthrough with no overflow or errors · production smoke test of `/`, `/join/*`, `/display`, `/poster` passed. Test accounts were removed afterwards; the live database starts empty.

## Needs live configuration (owner action)

1. **Supabase → Authentication → Sign In / Providers → Email → turn OFF "Confirm email".** Until then, new sign-ups get a "couldn't send email" error, because the built-in mailer won't send to non-team addresses.
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
