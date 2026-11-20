# Staff guide — PingPod Morrisville Rewards (beta)

For Joe and the Morrisville team. No technical knowledge needed.

App: **https://pingpod-morrisville-rewards.vercel.app**  ·  Staff area: **/admin**  ·
iPad board: **/display**  ·  Printable QR sign: **/poster**

This is a four-week Morrisville pilot that sits alongside the official PingPod app. It does not
handle bookings, door entry or payments, and it never asks for anyone's PingPod password.

## What customers do

1. Scan the QR code at the front desk or on a table. The app opens in Safari — no download.
2. First visit: type an email and tap **Continue** (no password, no confirmation email), then pick
   a public nickname and choose whether to appear on the leaderboards. Next time, the same email
   gets them straight back in, on any phone.
3. Tap **Start playing** when they begin and **Finish** when they're done. The timer keeps running
   if they lock the phone or close Safari; reopening the app shows it again.
4. Forgot to start the timer? **Log past play**: pick the day (up to 7 days back) and 30 / 60 / 90 /
   120 minutes or a custom amount.
5. Finished and logged sessions count right away — there's no approval step. We trust players to
   log their own time; staff only step in to fix obvious mistakes.
6. Friends can form a **crew** (2–8 people) and share an invite link or code.

Returning customers stay signed in, so they just open the app and tap Start playing.

## Research survey

New players see a one-time "Quick favor?" card asking them to fill out a short anonymous survey (it also stays on
their profile as "Research survey"). Change or remove the link in **Settings → Research survey**. In Google Forms,
keep "Collect email addresses" off so answers stay anonymous.

## Photos, bios and crew mottos

Players can add a profile photo (shown on the leaderboard, crew pages and the iPad) and a short bio;
crew owners can pick a crew color, emblem and motto. If anything is inappropriate: **Players → Manage →
Remove photo / Clear bio**, or **Crews → Manage → Clear motto**. Every change is in the activity log.

## Becoming staff

- Players sign in with just their email, so anyone who knows an email can open that player's
  account. That's fine for a leaderboard, but not for staff tools: **staff accounts need their own
  password** (8+ characters). The staff screen asks for it when you unlock it. After that, typing
  your email on the sign-in screen asks for that password (players never see a password box).
  Until a staff password is set, the database keeps staff tools shut.

- The first owner opens **/admin** while signed in and enters the one-time staff code they were
  given privately. Codes work once.
- Owners add other people from **Admin → Players**: the person signs up as a customer first, then
  find them, tap **Manage**, and choose **Make staff** (session fixes and moderation) or **Make owner**
  (also settings, rewards, staff and account deletions). **Admin → More → Staff** lists everyone
  with access.
- Staff access is stored on the server. Nobody can give themselves access by editing their profile.

## Fixing session mistakes (occasional, not a daily job)

Sessions count the moment a player finishes a timer or logs past play. **Admin → Sessions** lists
recent sessions so you can spot and fix anything that looks wrong — there's nothing to approve.

| Button | When | |
| --- | --- | --- |
| **Fix minutes** | The number is off (e.g. a forgotten timer) | Optional note |
| **Remove** | Didn't happen, duplicate, or clearly wrong — stops counting everywhere | Optional note (the player sees it) |
| **Restore** | Undo a removal (under the **Removed** filter) | — |

- Use the **Flagged** filter to see only sessions worth a second look.
- "N people playing now" at the top shows who has a timer running.
- You can't change your own sessions — ask another staff member.
- Every change is recorded in **Admin → More → Activity log** with who did it and when.

Flags (shown as yellow labels):

| Flag | Meaning | Suggested action |
| --- | --- | --- |
| **Timer ran to the 3-hour limit** | The timer was left running and stopped itself | If you know roughly how long they really played, fix the minutes |
| **Hit max length** | The player stopped it at or after the 3-hour cap | Fix if it looks wrong, or ask them |
| **Also has a timer session that day** | A logged entry on a day that already has a timer session | Possible duplicate — remove one if it is |

## Leaderboards

Leaderboards (in the app and on the iPad) show every player's logged minutes, except sessions staff
have removed. There's no separate "verified" board. Minutes are self-logged, so treat the rankings
as friendly competition rather than an audited record.

## Moderation

- **Players**: search by nickname or email, tap **Manage** → **Change nickname** or **Hide from
  leaderboards** (hides them from public boards and the iPad; their own stats stay visible to them).
- **Crews**: tap **Manage** → rename, hide from leaderboards, change owner, remove a member, or
  **Close crew**.
- A basic word filter blocks obvious offensive nicknames and crew names; anything else, rename
  or hide it.

## SPINDEX ratings

Players can add their SPINDEX rating (0–3000). It shows as **Self-reported** everywhere until staff
verify it. The app is not connected to SPINDEX, PodPlay or PingPod accounts and never calculates
SPINDEX.

To verify one (**Admin → More → SPINDEX ratings**): only after you have seen proof in person (for example the
player shows their SPINDEX profile in the official app). Write how you checked
("Saw SPINDEX app at front desk 11/20"). You can't verify your own rating. Decline anything you
can't confirm.

## Player requests

Players can ask for a correction on a session, a privacy change, or account deletion
(**Admin → More → Player requests**; the More tab shows a count when any are open). Fix what's
needed (**Open in Sessions** jumps to that player's sessions), write a short reply, and tap
**Resolve** (or **Close** if no action is needed). Players can also delete their own account from their profile at any time. Owners can
delete an account on request from **Players → Manage → Delete account** (a reason is required; this permanently removes
that person's sessions and ratings).

## The iPad scoreboard

1. On the front-desk iPad, open Safari to **https://pingpod-morrisville-rewards.vercel.app/display**.
2. Share → **Add to Home Screen**, then open it from the home screen (full screen, no browser bar).
3. Settings → Accessibility → **Guided Access** on; triple-click the side/home button to lock the
   iPad to the board.
4. Keep it plugged in. Set Display & Brightness → Auto-Lock → **Never**.
5. **Never sign in as staff on the iPad.** The board needs no login and shows only public nicknames,
   their stats and crew names.

It rotates through most minutes this week, highest SPINDEX, crew rankings, daily streaks, longest session and weekly highlights, and
refreshes itself within seconds when anyone finishes or logs a session. The small "Updated" time in the corner shows freshness;
if the internet drops it says the data may be out of date instead of pretending to be live.

## The QR sign

Open **/poster** on a computer and print it (letter size). The QR code points to the public app
address set in Settings, so it never points to a test address. Reprint if that address changes.

## Settings (owners)

| Section → setting | Default | What it does |
| --- | --- | --- |
| Pilot dates → Starts / Ends | Nov 23 – Dec 20 | Shown on Stats and used for exports |
| Timers → Stop timers after | 180 min | A timer left running stops here and gets flagged |
| Timers → Ask "Still playing?" after | 90 min | Check-in prompt on the player's phone |
| Logging past sessions → How far back | 7 days | How far back players can log |
| Logging past sessions → Longest session | 180 min | Longest single session a player can log |
| Crews → Largest crew / Members needed | 8 / 2 | Size limit, and members needed to appear on the board |
| iPad display → Seconds per screen, Screens to show | 15 s, all 6 screens (minutes, highest SPINDEX, crew rankings, daily streaks, longest session, this week) | Rotation on the front-desk board |
| Rewards → Show rewards to players | Off | Master switch for prizes |
| **Advanced** (tap to open) | — | QR address, venue name, shortest session (5 min), daily limit (300 min), which leaderboards players see |

## Rewards

Physical rewards (free time, merch, discounts) are **off**. Nothing is promised to customers.
To add one later: create it in **Admin → More → Rewards**, then turn it on only after Joe approves the
terms — the app requires an approval note (who approved, how it's fulfilled) before it can be
enabled, and **Show rewards to players** in Settings must also be on.

## Pilot stats

**Admin → Stats** shows six numbers:

| Tile | Meaning |
| --- | --- |
| Signed up | Accounts with a nickname, against the 20-player goal |
| Played at least once | Players with at least one counted session, against the goal |
| Came back | Played in 2 or more different weeks |
| Sessions | Counted sessions, and how many used the live timer |
| Minutes played | All counted minutes |
| Active crews | Crews with enough members, against the 4-crew goal |

Below that, **By week** shows players, returning players, new sign-ups, sessions, minutes and
crews with play for each week. **Download CSV** gives a weekly summary, one row per player, or one
row per session — with codes like `P3f9a12c0` instead of names or emails. Goals are targets to
compare against; report the real numbers.

## Privacy commitments

- Emails are never shown publicly; only staff can see them in Admin.
- Players choose whether their nickname appears on public boards and can change it any time.
- The iPad shows nicknames, stats and crew names only — never emails, notes or staff tools.
- Session notes are visible only to the player and staff.

## What the app does not prove

App activity is not proof that someone was physically at PingPod. A timer only measures time
between two taps, and logged entries are self-reported. That's fine for a fun, trust-based pilot.
If a physical prize is ever attached to a ranking, check the top entries against booking records
before awarding it.
