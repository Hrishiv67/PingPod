# PingPod Morrisville — Rewards Beta

An approachable mobile-first QR companion for the Morrisville PingPod community. Built as a clean starter for continued work in Claude Code.

![Project status](https://img.shields.io/badge/status-starter%20beta-ec278d)

## What works in this starter

- Clean branded signup screen with **real Supabase passwordless email login** when configured.
- Login persists between visits and works on mobile; first-time account asks for public nickname and leaderboard visibility.
- **Start / stop timer**, with start and stop timestamps recorded by the database. Timer survives tab refresh and reconnect; capped at three hours.
- **Manually log past playing time** (last seven days, 5–180 minutes).
- **Public individual and crew leaderboards**, selectable week/month/all-time, with an attractive `/display` or `/?display=1` iPad scoreboard and join QR.
- **Crews**: create, copy an invite code, join, leave if not crew owner. Existing history doesn't move to newly joined crews.
- **Basic admin approval queue**, once a manager's account UUID is added to `private.admins`.
- Clearly marked **demo mode** with a few *sample* competitors if no Supabase environment variables exist. Demo interactions work in one browser using localStorage; they are not real accounts or shared rankings.
- Profile editing, leaderboard opt-out, session history, and responsive layout.

The project intentionally does **not** include booking/PodPlay integrations, official SPINDEX synchronization, paid rewards, or public rewards claims. Their access/approval has not been established. This is a separate Morrisville community companion, not an official PingPod sign-in form.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open the printed local URL. Without `.env.local` you'll see a visible **Explore working demo** button. Use the sample crew invite code `DEMO2027` to try joining in preview mode. To open the display on a second device use `/?display=1` (demo state doesn't sync between devices).

## Connect a real database and real accounts

1. Create a **new Supabase project specifically for this pilot**. Don't reuse an unrelated production project's database.
2. Open its SQL editor and run [`supabase/schema.sql`](supabase/schema.sql) once. It creates secure tables, policies, server-owned timer functions, aggregate public leaderboard functions, teams, and an admin review queue.
3. In Supabase Authentication, enable email OTP/magic links and set **Site URL** and **Redirect URLs** to the local preview and eventual public Vercel domain. Configure a custom SMTP provider if you anticipate regular public pilot traffic; default email limits are restrictive. Google OAuth can be added later.
4. Copy `.env.example` to `.env.local` and fill:

   ```ini
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

5. Check the Supabase Data API exposure settings. The SQL includes `GRANT` permissions **and** RLS policies because newly created tables might not be automatically exposed. Use only the publishable key in the browser. **Never put a service-role or secret key in `VITE_` variables.**
6. Run the app, sign in, select your nickname, and test a timer + manual session.
7. To allow Joe or a designated manager to approve entries, retrieve that person's `auth.users.id` after they sign in, then run this **manually** in the SQL editor:

   ```sql
   insert into private.admins(user_id) values ('REPLACE_WITH_MANAGER_AUTH_UUID');
   ```

   The Admin tab appears after the manager refreshes. Do not use editable profile metadata to grant admin roles.

## Deploy to Vercel

- Select the repository and set **Root Directory** to `morrisville-rewards` if this folder is nested inside another repo.
- Framework: **Vite**; Build: `npm run build`; Output directory: `dist`.
- Configure the same `VITE_` environment variables in Vercel.
- Add the final domain to Supabase Auth's allowed redirect URLs.
- `vercel.json` includes an SPA fallback for `/display`.
- Print the QR from the real `/?display=1` screen after domain is final. The join QR always targets the current origin; avoid printing a development URL.

## Data trust and pilot rules

All new sessions are labeled `pending`. The leaderboard shown here is explicitly labeled **community / self-reported** and includes pending + approved sessions. Only administrators can approve or reject a logged session. Do not attach prizes to self-reported rankings. A stricter verified-only leaderboard, fraud checks, admin correction/audit trail, and actual booking corroboration are logical next steps before incentives or a bigger rollout.

The server is the time source for started/stopped live sessions. Manual entries are capped but aren't proof of venue attendance. A scanned join QR doesn't prove physical presence. Profiles share only public nicknames with the community and can opt out of public rankings. Avoid entering sensitive notes in this pilot.

## Common commands

```bash
npm run dev
npm run build
npm test
```

## Developer map

| File | Role |
| --- | --- |
| `src/App.tsx` | Customer routes/views, timer UX, public display, teams, admin queue |
| `src/lib/api.ts` | Typed Supabase reads/writes and auth configuration |
| `src/lib/demo.ts` | Explicit preview-only local state and sample players |
| `src/lib/metrics.ts` | Shared minute/streak/period helpers |
| `src/styles.css` | Branded mobile and iPad interface |
| `src/logo.ts` | User-owned PingPod mark from the preexisting PingPod GitHub repo |
| `supabase/schema.sql` | Database/RLS/permissions/RPC operations |

### Suggested next Claude Code prompt

> Continue the existing code in `morrisville-rewards/`. Preserve the visual design and functioning flows. First inspect `README.md`, `src/App.tsx`, `src/lib/api.ts`, and `supabase/schema.sql`. Fix bugs and strengthen verification/admin capabilities before adding complexity. Keep customer actions to Start Playing / Log Past Play, don't invent a SPINDEX API connection, and run `npm run build` + `npm test` after each change. Reuse the existing source rather than generating a second website.

---

**Brand note:** The PingPod logo asset is reused from an existing user-owned repository. The owner reports Morrisville franchisee support for this pilot. Any required corporate/API/branding publication permissions should still be confirmed before public launch.
