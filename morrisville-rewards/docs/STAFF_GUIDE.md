# Staff guide — PingPod Morrisville Rewards (beta)

For Joe and the Morrisville team. No technical knowledge needed.

App: **https://pingpod-morrisville-rewards.vercel.app**  ·  Staff area: **/admin**  ·
iPad board: **/display**  ·  Printable QR sign: **/poster**

This is a four-week Morrisville pilot that sits alongside the official PingPod app. It does not
handle bookings, door entry or payments, and it never asks for anyone's PingPod password.

## What customers do

1. Scan the QR code at the front desk or on a table. The app opens in Safari — no download.
2. First visit: enter an email and create a password, then pick a public nickname and choose
   whether to appear on the leaderboards.
3. Tap **Start playing** when they begin and **Finish** when they're done. The timer keeps running
   if they lock the phone or close Safari; reopening the app shows it again.
4. Forgot to start the timer? **Log past play**: pick the day (up to 7 days back) and 30 / 60 / 90 /
   120 minutes or a custom amount.
5. Finished and logged sessions count right away — there's no approval step. We trust players to
   log their own time; staff only step in to fix obvious mistakes.
6. Friends can form a **crew** (2–8 people) and share an invite link or code.

Returning customers stay signed in, so they just open the app and tap Start playing.

## Becoming staff

- The first owner opens **/admin** while signed in and enters the one-time staff code they were
  given privately. Codes work once.
- Owners add other people in **Admin → Staff**: the person must sign up as a customer first; then
  search for their nickname and choose **Staff** (session fixes and moderation) or **Owner** (also
  settings, rewards, staff and account deletions).
- Staff access is stored on the server. Nobody can give themselves access by editing their profile.

## Fixing session mistakes (occasional, not a daily job)

Sessions count the moment a player finishes a timer or logs past play. **Admin → Review** is a list
of recent sessions so you can spot and fix anything that looks wrong — you don't need to approve
anything.

| Action | When | Reason needed? |
| --- | --- | --- |
| **Adjust minutes** | The number is off (e.g. a forgotten timer) | Yes |
| **Reject** | Didn't happen, duplicate, or clearly wrong — removes it from all totals | Yes |
| **Reopen** | Undo a reject or adjustment | Yes |

- You can't change your own sessions — ask another staff member.
- Every change is recorded in **Admin → Audit log** with who did it, when, and the reason.

Flags worth a glance:

| Flag (as shown in Admin) | Meaning | Suggested action |
| --- | --- | --- |
| **Timer ran to the 3-hour limit** | The timer was left running and stopped itself at 3 hours | If you know roughly how long they really played, adjust it |
| **Hit max length** | The player stopped it at or after the 3-hour cap | Adjust if it looks wrong, or ask them |
| **Also has a timer session that day** | A logged entry on a day that already has a timer session | Possible duplicate — reject one if it is |
| **too_short** | Timer stopped under 5 minutes | Already not counted; nothing to do |

Players with removed (rejected) time show a count next to their name.

## Leaderboards

Leaderboards (in the app and on the iPad) show every player's logged minutes, except sessions staff
have rejected. There's no separate "verified" board. Minutes are self-logged, so treat the rankings
as friendly competition rather than an audited record.

## Moderation

- **Players**: search by nickname. You can **rename** an inappropriate nickname or **hide** a
  player from public boards and the iPad (their own stats stay visible to them).
- **Crews**: rename, hide, archive, change the owner, or remove a member.
- A basic word filter blocks obvious offensive nicknames and crew names; anything else, rename
  or hide it.

## SPINDEX ratings

Players can add their SPINDEX rating (0–3000). It shows as **Self-reported** everywhere until staff
verify it. The app is not connected to SPINDEX, PodPlay or PingPod accounts and never calculates
SPINDEX.

To verify one (**Admin → SPINDEX**): only after you have seen proof in person (for example the
player shows their SPINDEX profile in the official app). Write how you checked
("Saw SPINDEX app at front desk 11/20"). You can't verify your own rating. Reject anything you
can't confirm.

## Player requests

Players can ask for a correction on a session, a privacy change, or account deletion
(**Admin → Requests**). Fix what's needed (e.g. adjust the session), write a short reply, and mark it
resolved. Players can also delete their own account from their profile at any time. Owners can
delete an account on request from **Players** (a reason is required; this permanently removes
that person's sessions and ratings).

## The iPad scoreboard

1. On the front-desk iPad, open Safari to **https://pingpod-morrisville-rewards.vercel.app/display**.
2. Share → **Add to Home Screen**, then open it from the home screen (full screen, no browser bar).
3. Settings → Accessibility → **Guided Access** on; triple-click the side/home button to lock the
   iPad to the board.
4. Keep it plugged in. Set Display & Brightness → Auto-Lock → **Never**.
5. **Never sign in as staff on the iPad.** The board needs no login and shows only public nicknames,
   their stats and crew names.

It rotates through most minutes this week, current streaks, top crews and weekly highlights, and
refreshes itself within seconds when anyone finishes or logs a session. The small "Updated" time in the corner shows freshness;
if the internet drops it says the data may be out of date instead of pretending to be live.

## The QR sign

Open **/poster** on a computer and print it (letter size). The QR code points to the public app
address set in Settings, so it never points to a test address. Reprint if that address changes.

## Settings (owners)

| Setting | Default | What it does |
| --- | --- | --- |
| Max session length | 180 min | Timers stop and get flagged after this |
| Check-in reminder | 90 min | "Still playing?" prompt on the player's phone |
| Manual entry min / max | 5 / 180 min | Allowed range for logged sessions (also the shortest timer that counts) |
| Backdating | 7 days | How far back players can log |
| Daily cap | 300 min | Most minutes one player can record on one day |
| Crew size | 2–8 | Crews need the minimum to appear on the board; can't exceed the maximum |
| Display rotation | 15 s | Time per iPad screen |
| Pilot start / end | — | Used for analytics |
| Public app address | the Vercel URL | Used for the QR code |

## Rewards

Physical rewards (free time, merch, discounts) are **off**. Nothing is promised to customers.
To add one later: create it in **Admin → Rewards**, then turn it on only after Joe approves the
terms — the app requires an approval note (who approved, how it's fulfilled) before it can be
enabled, and the master "Rewards" switch in Settings must also be on.

## Pilot analytics

**Admin → Analytics** shows:

| Metric | Meaning |
| --- | --- |
| Registered players | Accounts with a nickname |
| Players with a session | Logged at least one counted session |
| Repeat players | Played on 2+ different days / in 2+ different weeks |
| Sessions / minutes | Counted vs. rejected by staff; timer vs. logged later |
| Active crews | Crews with enough members, and those with play this week |
| Weekly table | Per week: active, returning and new players, sessions, minutes, crews with play |

**Export CSV** downloads weekly totals, per-player totals, or per-session rows. Exports use codes
like `P3f9a12c0` instead of names or emails. Pilot goals such as 20+ players and 4+ active crews
are targets to compare against — report the real numbers.

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
