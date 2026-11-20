# PingPod Morrisville Rewards · Beta

A phone-first companion for players at PingPod Morrisville. Players scan a QR code, make an account, tap **Start playing**, and compete on weekly leaderboards with their crews. An iPad at the front desk shows the standings. Staff get a small dashboard for fixes, moderation and pilot analytics.

It's a local four-week pilot. It isn't the official PingPod app, booking system or PodPlay, and it never asks for PingPod passwords.

**Live app:** https://pingpod-morrisville-rewards.vercel.app · **iPad board:** `/display` (or `/?display=1`) · **Printable QR sign:** `/poster` · **Staff:** `/admin`

## What players can do

- Sign in with just an email: no password and no confirmation email (separate from their PingPod login). Pick a nickname and avatar color, and choose whether they appear on public boards.
- **Start playing** → server-timed session that survives refreshes, locked phones and lost signal. They get a check-in prompt at 90 minutes, and timers stop on their own at 3 hours.
- **Log past play**: date (last 7 days), 30/60/90/120 or custom minutes, optional note.
- Time counts immediately: the pilot trusts players' own logs. Staff can fix or remove obvious mistakes.
- Leaderboards: minutes (week / month / all time), a **SPINDEX** board right after it (self-reported unless staff verify), crews (total + per member), daily streaks and longest session.
- Crews of 2–8: create, share an invite link or code, see each member's minutes, transfer ownership, leave. Crew totals count play from when each person joined.
- Profile: totals, milestones with progress, SPINDEX (labeled self-reported unless staff verify it), history with "request a correction", privacy toggles, sign out, delete account.

## Project layout

| Path | What |
| --- | --- |
| `src/App.tsx` | Routing, auth gate, server-clock sync, offline finish queue, bottom nav |
| `src/screens/` | Welcome, Onboarding, Home (timer), LogPlaySheet, Rankings, Crew, Me, JoinCrew, ResetPassword |
| `src/admin/` | Staff dashboard (lazy-loaded at `/admin`) |
| `src/display/` | iPad scoreboard (`/display`) and QR poster (`/poster`) |
| `src/lib/api.ts` | The only data layer: typed calls to Supabase functions; picks demo mode when unconfigured |
| `src/lib/demo.ts` | In-browser demo backend with labeled "Sample ·" players (no env vars) |
| `src/components/`, `src/styles/` | UI kit (buttons, sheets, toasts…), brand tokens (black/white/#FF0078, Barlow) |
| `supabase/migrations/` | Database schema, security, and every rule (source of truth) |
| `supabase/tests/` | QA account setup/teardown, rollback-only time-logic test |
| `tests/` | Unit tests (time helpers, demo rules) and the live API integration suite |
| `docs/` | `SETUP.md` (production config), `STAFF_GUIDE.md` (for Joe/staff), `API.md` (database functions any client can call) |

All rules live in Postgres functions (see `docs/API.md`), so any future client can share the same backend and accounts.

## Run locally

Node 22+.

```bash
npm install
npm run dev
```

With no `.env.local`, the app runs a clearly labeled **demo mode** (data stays in your browser; staff tools are disabled). To use the real database:

```ini
# .env.local (never commit)
VITE_SUPABASE_URL=https://apojuerjhvyzjmpanqih.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# optional: the address QR codes point to (otherwise taken from pilot settings / current site)
VITE_PUBLIC_APP_URL=https://pingpod-morrisville-rewards.vercel.app
```

Only the publishable key belongs in `VITE_` variables. Never put the service-role/secret key in the frontend.

## Checks

```bash
npm run typecheck        # TypeScript
npm test                 # unit tests (time helpers, demo rules)
npm run build            # production build
npm run test:integration # live API suite — needs QA accounts, see tests/integration.test.mjs
```

## Deploy

Vercel project `pingpod-morrisville-rewards`, root directory `morrisville-rewards`, framework Vite, output `dist`. `vercel.json` rewrites every path to `index.html`. Set the two `VITE_SUPABASE_*` variables for Production and Preview. Full checklist, including the Supabase Auth settings, is in [`docs/SETUP.md`](docs/SETUP.md).

## Database changes

Add a new numbered file in `supabase/migrations/`, apply it (SQL editor or `supabase db push`), re-run the revoke/grant block from `20261119000400_admin.sql` for any new function, and run `npm run db:schema` to refresh `supabase/schema.sql`.
