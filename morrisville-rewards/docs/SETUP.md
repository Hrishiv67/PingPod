# Production setup

Everything needed to run the Morrisville Rewards pilot in production, and to rebuild it from
scratch if ever needed.

| Piece | Where |
| --- | --- |
| Web app | Vercel project `pingpod-morrisville-rewards` → https://pingpod-morrisville-rewards.vercel.app (deploys from branch `morrisville-rewards-starter`, root directory `morrisville-rewards`) |
| Database + auth | Supabase project `pingpod-morrisville` · region us-east-1 · ref `apojuerjhvyzjmpanqih` · free plan |
| Schema | [`supabase/migrations/`](../supabase/migrations) — already applied to the project above |

## 1. Supabase Auth settings (dashboard, one time)

Open https://supabase.com/dashboard/project/apojuerjhvyzjmpanqih

1. **Authentication → Sign In / Providers → Email**
   - **Confirm email: OFF** — required. With it on, Supabase tries to email every new player a
     confirmation link; the built-in mailer only delivers to your own Supabase team, so sign-ups
     fail. Off = players are signed in immediately after creating an account.
   - Minimum password length: **6** (the app checks the same).
   - Leave "Allow new users to sign up" ON.
2. **Authentication → URL Configuration**
   - Site URL: `https://pingpod-morrisville-rewards.vercel.app`
   - Redirect URLs: `https://pingpod-morrisville-rewards.vercel.app/**` and `http://localhost:5173/**`
3. **(Optional, for "Forgot password") Authentication → Emails → SMTP Settings** — enable custom SMTP:
   - Host `smtp.gmail.com`, port `465`
   - Username: the Gmail address (a dedicated one such as a pilot inbox is best)
   - Password: a **Google App Password** (Google Account → Security → 2-Step Verification must be on →
     App passwords). Not the normal Gmail password.
   - Sender email: same Gmail address · Sender name: `PingPod Morrisville Rewards`
   - Gmail allows roughly 500 messages/day — plenty for the pilot.
   Without SMTP everything works except password-reset emails; staff can't reset passwords, so a
   player who forgets theirs would create a new account.

Rate limits: Supabase limits sign-ups/sign-ins per IP address. Everyone on the venue Wi-Fi shares one
IP; the defaults (about 30 per 5 minutes) are fine for normal traffic. If a busy event triggers
"too many requests", raise it in **Authentication → Rate Limits**.

Security note: with email confirmation off, nobody proves they own the email they sign up with.
That's acceptable for a nickname leaderboard; staff access is granted separately (below), never by
email address.

## 2. Claim owner access

1. Sign up in the app like a customer and pick a nickname.
2. Open `/admin` and enter the **one-time staff code** you were given privately (it is not in this
   repository). It works once and expires.
3. Add Joe: he signs up as a customer, then you open **Admin → Staff**, find his nickname and give
   him **Owner**.

Lost the code or need another? Create one in the Supabase SQL editor (replace the code text;
letters/digits only, dashes are ignored):

```sql
insert into private.admin_claim_codes (code_hash, role, expires_at)
values (encode(extensions.digest(upper('PICKACODE1234'), 'sha256'), 'hex'), 'owner', now() + interval '14 days');
```

Or grant directly once the person has signed up:

```sql
insert into private.admins (user_id, role)
select id, 'owner' from auth.users where email = 'person@example.com';
```

## 3. Vercel environment variables

Project → Settings → Environment Variables (Production, Preview, Development):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://apojuerjhvyzjmpanqih.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → publishable key (`sb_publishable_…`) |
| `VITE_PUBLIC_APP_URL` (optional) | `https://pingpod-morrisville-rewards.vercel.app` — public address used for join links/QR codes (the owner can also set `public_app_url` in Admin → Settings) |

Only the publishable key goes in `VITE_` variables (they are bundled into the browser).
**Never** add the service-role / secret key to Vercel or the repository.
Redeploy after changing variables. Without these variables the app runs a labeled demo mode.

Build settings: Framework Vite · Root `morrisville-rewards` · Build `npm run build` · Output `dist`.
`vercel.json` rewrites every path to `index.html` so `/display`, `/admin`, `/join/CODE` work on reload.

## 4. Local development

```bash
cd morrisville-rewards
cp .env.example .env.local   # fill in the two VITE_ values above
npm install
npm run dev                  # http://localhost:5173
```

## 5. Changing the database later

1. Add a new file in `supabase/migrations/` with a later timestamp prefix (never edit applied files).
2. Apply it: Supabase SQL editor (paste and run), or `supabase link --project-ref apojuerjhvyzjmpanqih`
   then `supabase db push`.
3. **Re-run the permission block at the end of every migration that adds functions.** Supabase grants
   EXECUTE on new functions to `anon` by default:

   ```sql
   revoke execute on all functions in schema private from public, anon, authenticated;
   revoke execute on all functions in schema public from public, anon, authenticated;
   grant execute on all functions in schema public to authenticated;
   grant execute on function public.get_leaderboard(text, text, text, int), public.get_crew_leaderboard(text, text, int),
     public.get_display_data(), public.preview_crew(text) to anon;
   ```
4. Keep every write in a `security definer` function with `set search_path = ''`, validate on the
   server, and never grant INSERT/UPDATE/DELETE on tables to `anon` or `authenticated`.
5. Run Supabase → Advisors → Security after changes. Expected findings: "RLS enabled, no policy" on
   `private.*` tables (intentional — nothing reads them directly) and "security definer function
   executable" for the player/staff functions (intentional — each checks who is calling).

## 6. Free-plan caveats

- Free Supabase projects **pause after about 7 days with no activity**. During the pilot the iPad
  board and players keep it active. If it pauses, restore it from the dashboard (data is kept).
- Free plan has no automatic point-in-time backups. Export weekly during the pilot:
  **Admin → Analytics → Export CSV**, and/or Supabase → Database → Backups / `pg_dump`.
- Scheduled job `pingpod-close-stale-sessions` (pg_cron, every 10 minutes) closes abandoned timers.
  Check it under Database → Cron if timers ever stay "active" past 3 hours.

## 7. Realtime

The iPad and leaderboards subscribe to the public broadcast channel `leaderboard` (event
`changed`), sent by database triggers. If live updates stop, check Project Settings → Realtime
allows public channels; the display also polls on a timer, so it keeps updating regardless.
