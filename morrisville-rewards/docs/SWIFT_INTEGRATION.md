# Building the iOS app on the same backend

> **Status:** the Swift below was written against the documented database functions but **has not
> been compiled or run** (this project was built in a Linux environment without Xcode). Treat it as
> a precise starting point and expect small API-signature fixes for your `supabase-swift` version.

## Why this works

All rules — timer limits, manual-log validation, crews, rankings, achievements,
privacy — live in Postgres functions in Supabase (see [API.md](API.md)). The web app is a thin
client over those functions; a SwiftUI app can be the same. Results:

- One account works in both apps (same email; players never need a password).
- A session started on the web shows as running in the iOS app (and vice versa).
- Both apps see identical leaderboards. You can't accidentally implement a different rule.

Don't re-implement scoring in Swift. Call the function and display what comes back.

## 1. Install

Xcode → File → Add Package Dependencies → `https://github.com/supabase/supabase-swift` (version 2.x)
→ add the **Supabase** product to the app target.

## 2. Client

The publishable key is designed to ship inside apps (row-level security does the protection).
**Never** put a service-role / secret key in the app.

```swift
import Foundation
import Supabase

enum Backend {
    static let url = URL(string: "https://apojuerjhvyzjmpanqih.supabase.co")!
    // Supabase dashboard → Project Settings → API Keys → Publishable key
    static let publishableKey = "sb_publishable_LgSaE5LuNEnlmzikgiCZwA_hcsN8IXP"

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = PostgresDate.parse(raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                    debugDescription: "Bad timestamp \(raw)"))
        }
        return d
    }()

    static let client = SupabaseClient(
        supabaseURL: url,
        supabaseKey: publishableKey,
        options: SupabaseClientOptions(db: .init(decoder: decoder))
    )
}

/// Postgres sends timestamps like 2026-11-19T05:22:40.816123+00:00 (microseconds).
/// ISO8601DateFormatter only handles milliseconds, so trim the fraction first.
enum PostgresDate {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ s: String) -> Date? {
        let trimmed = s.replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
        return withFraction.date(from: trimmed) ?? plain.date(from: trimmed)
    }
}
```

Date-only columns (`played_on`, `week_start`, `pilot_start`) are modeled as `String`
(`"2026-11-19"`) to avoid ambiguous parsing. Use the Morrisville calendar
(`TimeZone(identifier: "America/New_York")`) when you format them.

## 3. Sign-in (just an email)

Players only type their email. The app derives a password from it and uses the normal Supabase
email + password sign-in, exactly like the website (`src/lib/emailKey.ts`). The key must match the
web app byte for byte, or the same person ends up with two different accounts.

```swift
import CryptoKit

enum EmailKey {
    static let salt = "|pingpod-morrisville-email-only-v1"

    static func normalize(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// "Pp!" + first 40 hex chars of SHA-256(normalized email + salt) + "9"
    static func key(for email: String) -> String {
        let digest = SHA256.hash(data: Data((normalize(email) + salt).utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "Pp!" + hex.prefix(40) + "9"
    }
}

enum EnterResult { case signedIn, staffPassword }

/// Signs in, or creates the account if it's new. `.staffPassword` only happens for staff accounts,
/// which keep a real password; players never see a password.
func enter(email raw: String) async throws -> EnterResult {
    let auth = Backend.client.auth
    let email = EmailKey.normalize(raw)
    let key = EmailKey.key(for: email)
    do {
        try await auth.signIn(email: email, password: key)
        return .signedIn
    } catch {
        guard "\(error)".localizedCaseInsensitiveContains("invalid login credentials") else { throw error }
    }
    do {
        try await auth.signUp(email: email, password: key)   // "Confirm email" is OFF → signed in
        return .signedIn
    } catch {
        if "\(error)".localizedCaseInsensitiveContains("already registered") { return .staffPassword }
        throw error
    }
}

// Restore on launch (nil = show the welcome screen); sessions persist in the Keychain.
let session = try? await Backend.client.auth.session
// Sign out
try await Backend.client.auth.signOut()
```

Write the welcome screen as one email field and a **Continue** button, with "No password needed"
under it. Only show a password field after `.staffPassword` (staff accounts), then
`auth.signIn(email:password:)` with what they type.

Staff: a staff or owner role only works once the account has a real password (the database checks
this). `get_me` returns `admin_role = nil` and `staff_needs_password = true` until then. Staff tools
can stay on the website (`/admin`); if you add them to the app, set the password with
`auth.update(user: UserAttributes(password:))` first.

After sign-in call `get_me`. If `profile == nil`, show the nickname screen (`save_profile`).
Never ask for — or label anything as — the player's official PingPod password; this is a separate
Morrisville Rewards account.

## 4. Models

```swift
struct Profile: Codable, Identifiable {
    let id: UUID
    let displayName: String
    let avatarColor: String          // pink, white, blue, green, orange, purple
    let showOnLeaderboard: Bool
    let showSpindex: Bool
    let hiddenByAdmin: Bool
    let createdAt: Date
}

struct PlaySession: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let method: String               // timer | manual
    let status: String               // active | pending | approved | rejected | cancelled
    let startedAt: Date
    let endedAt: Date?
    let playedOn: String             // Morrisville calendar date, "yyyy-MM-dd"
    let minutes: Int
    let submittedMinutes: Int?
    let note: String?
    let clientRequestId: UUID?
    let lastCheckinAt: Date?
    let autoClosed: Bool
    let flags: [String]              // auto_closed, hit_max, same_day_as_timer, too_short
    let reviewedAt: Date?
    let reviewReason: String?
    let createdAt: Date
}

struct Stats: Codable {
    let weekVerified, weekPending, monthVerified, monthPending: Int
    let totalVerified, totalPending, sessions, pendingSessions, longestSession: Int
    let currentStreak, longestStreak: Int   // days in a row (alive through today if played yesterday)
    let rankWeekVerified, rankWeekCommunity: Int?
    let rankedWeekVerified, rankedWeekCommunity: Int
    // Sessions count immediately (no approval step), so *Pending is normally 0.
    // Show one number: weekVerified + weekPending, totalVerified + totalPending.
    // Use rankWeekCommunity (it matches the boards, which use the "community" scope).
}

struct PilotSettings: Codable {
    let venueName: String
    let publicAppUrl: String
    let pilotStart, pilotEnd: String?
    let maxSessionMinutes, checkinReminderMinutes: Int
    let manualMinMinutes, manualMaxMinutes, backdateDays, dailyMinutesCap: Int
    let crewMinSize, crewMaxSize: Int
    let autoApproveTimer: Bool
    let defaultBoardScope, displayScope: String
    let displayRotationSeconds: Int
    let displaySlides, boardsEnabled: [String]
    let rewardsEnabled: Bool
}

struct CrewSummary: Codable { let id: UUID; let name: String; let inviteCode: String; let isOwner: Bool }

struct SpindexClaim: Codable {
    let id: UUID
    let rating: Int
    let status: String               // unverified | verified
    let source: String               // self_reported | staff_verified | official_integration
    let verifiedAt: Date?
    let createdAt: Date
    var isVerified: Bool { status == "verified" }
}

struct MeResponse: Codable {
    let serverNow: Date
    let profile: Profile?            // nil → ask for a nickname
    let adminRole: String?           // owner | staff | nil (nil until a staff account has a password)
    let staffNeedsPassword: Bool?    // on the staff list but still email-only
    let activeSession: PlaySession?
    let crew: CrewSummary?
    let spindex: SpindexClaim?
    let stats: Stats?                // nil until a profile exists
    let settings: PilotSettings
}

struct LeaderboardRow: Codable, Identifiable {
    var id: UUID { userId }
    let rank: Int
    let userId: UUID
    let displayName: String
    let avatarColor: String
    let value: Int                   // minutes, current streak (days), longest minutes, or rating
    let secondary: Int?              // streaks: longest streak
    let sessions: Int?
    let detail: String?              // longest: date · spindex: "verified" / "self_reported"
    let isMe: Bool
}

struct CrewLeaderboardRow: Codable, Identifiable {
    var id: UUID { crewId }
    let rank: Int
    let crewId: UUID
    let name: String
    let minutes, members, contributors, avgMinutes: Int
    let isMine: Bool
}

struct CrewMember: Codable, Identifiable {
    var id: UUID { userId }
    let userId: UUID
    let displayName: String
    let avatarColor: String
    let isOwner, isMe: Bool
    let joinedAt: Date
    let minutes: Int
}

struct MyCrew: Codable {
    let id: UUID
    let name: String
    let inviteCode: String
    let isOwner: Bool
    let hiddenByAdmin: Bool
    let minMembers, maxMembers: Int
    let rank: Int?                   // nil until the crew has min_members
    let crewsRanked: Int
    let totalMinutes: Int
    let members: [CrewMember]
}

struct CrewPreview: Codable { let name: String; let members: Int; let maxMembers: Int }
struct Crew: Codable { let id: UUID; let name: String; let inviteCode: String }

struct Achievement: Codable, Identifiable {
    var id: String { code }
    let code, title, description: String
    let target, progress: Int
    let earnedAt: Date?
    var earned: Bool { earnedAt != nil }
}

struct DisplayRow: Codable { let rank: Int; let displayName: String; let avatarColor: String
                             let value: Int; let sessions: Int?; let secondary: Int?; let detail: String? }
struct DisplayCrew: Codable { let rank: Int; let name: String; let minutes, members, avgMinutes: Int }
struct DisplayData: Codable {
    let generatedAt: Date
    let scope: String
    let rotationSeconds: Int
    let slides: [String]
    let publicAppUrl, venueName, weekStart: String
    let minutes, longest, streaks: [DisplayRow]
    let crews: [DisplayCrew]
}
```

## 5. Calling functions

RPC return shapes: a function returning a single row (`start_session`, `save_profile`, …) comes back
as one JSON object; `returns table` functions (`get_leaderboard`, …) as an array; `jsonb`
functions as that JSON; `void` functions as nothing.

Parameter names must match the SQL names exactly (`p_…`). Optional params left `nil` are omitted
and the database default is used.

```swift
let db = Backend.client

// Load everything for the home screen
let me: MeResponse = try await db.rpc("get_me").execute().value

// Profile
struct SaveProfile: Encodable {
    let p_display_name: String
    let p_avatar_color: String
    let p_show_on_leaderboard: Bool
    let p_show_spindex: Bool
}
let profile: Profile = try await db.rpc("save_profile", params: SaveProfile(
    p_display_name: "SpinDoctor", p_avatar_color: "pink",
    p_show_on_leaderboard: true, p_show_spindex: true)).execute().value

// Timer
struct StartParams: Encodable { let p_client_request_id: UUID }
let requestId = UUID()                       // persist until the call succeeds; reuse on retry
let running: PlaySession = try await db.rpc("start_session",
    params: StartParams(p_client_request_id: requestId)).execute().value

struct IdParam: Encodable { let p_id: UUID }
let _: PlaySession = try await db.rpc("checkin_session", params: IdParam(p_id: running.id)).execute().value

struct StopParams: Encodable { let p_id: UUID; let p_ended_at: Date? }
// p_ended_at: when the player tapped Finish, if the request had to wait for signal.
// The server accepts it only within the last 30 minutes and never in the future.
let finished: PlaySession = try await db.rpc("stop_session",
    params: StopParams(p_id: running.id, p_ended_at: tappedFinishAt)).execute().value
// finished.status == "cancelled" && finished.flags.contains("too_short") → under the minimum; not counted

let cancelled: PlaySession = try await db.rpc("cancel_session", params: IdParam(p_id: running.id)).execute().value

// Log past play (date is the Morrisville calendar date)
struct LogParams: Encodable { let p_played_on: String; let p_minutes: Int; let p_note: String?; let p_client_request_id: UUID }
let logged: PlaySession = try await db.rpc("log_session", params: LogParams(
    p_played_on: "2026-11-18", p_minutes: 60, p_note: nil, p_client_request_id: UUID())).execute().value

// History (row-level security returns only the signed-in player's rows)
let history: [PlaySession] = try await db.from("play_sessions")
    .select().order("started_at", ascending: false).limit(100).execute().value

// Crews
struct NameParam: Encodable { let p_name: String }
struct CodeParam: Encodable { let p_code: String }
struct UserParam: Encodable { let p_user_id: UUID }
let crew: Crew = try await db.rpc("create_crew", params: NameParam(p_name: "Topspin Club")).execute().value
let preview: CrewPreview? = try await db.rpc("preview_crew", params: CodeParam(p_code: "ABCD2345")).execute().value
let joined: Crew = try await db.rpc("join_crew", params: CodeParam(p_code: "ABCD2345")).execute().value
try await db.rpc("leave_crew").execute()
let renamed: Crew = try await db.rpc("rename_crew", params: NameParam(p_name: "Topspin Kings")).execute().value
let newCode: Crew = try await db.rpc("regenerate_crew_code").execute().value
try await db.rpc("transfer_crew", params: UserParam(p_user_id: memberId)).execute()
try await db.rpc("remove_crew_member", params: UserParam(p_user_id: memberId)).execute()

struct BoardParams: Encodable { let p_period: String; let p_scope: String }
let myCrew: MyCrew? = try await db.rpc("get_my_crew",
    params: BoardParams(p_period: "week", p_scope: "community")).execute().value

// Leaderboards — metric: minutes | streaks | longest | spindex
//               period: week | month | all
// Scope: always pass settings.defaultBoardScope ("community" = everything staff haven't removed).
// Sessions count immediately, so don't show a verified/community toggle.
struct LeaderboardParams: Encodable { let p_metric: String; let p_period: String; let p_scope: String; let p_limit: Int }
let board: [LeaderboardRow] = try await db.rpc("get_leaderboard", params: LeaderboardParams(
    p_metric: "minutes", p_period: "week", p_scope: "community", p_limit: 50)).execute().value
struct CrewBoardParams: Encodable { let p_period: String; let p_scope: String; let p_limit: Int }
let crews: [CrewLeaderboardRow] = try await db.rpc("get_crew_leaderboard", params: CrewBoardParams(
    p_period: "week", p_scope: "community", p_limit: 50)).execute().value

// Achievements
let achievements: [Achievement] = try await db.rpc("get_my_achievements").execute().value

// SPINDEX (self-reported until staff verify; 0–3000)
struct SpindexParams: Encodable { let p_rating: Int; let p_note: String? }
let claim: SpindexClaim = try await db.rpc("submit_spindex",
    params: SpindexParams(p_rating: 1450, p_note: "From the SPINDEX app, Nov 2026")).execute().value
try await db.rpc("remove_spindex").execute()

// Ask staff for a correction / privacy / deletion / other
struct RequestParams: Encodable { let p_kind: String; let p_message: String; let p_session_id: UUID? }
try await db.rpc("submit_request", params: RequestParams(
    p_kind: "correction", p_message: "That was 45 minutes, not 60.", p_session_id: logged.id)).execute()

// Delete account (App Store requires in-app deletion — this satisfies it)
try await db.rpc("delete_my_account").execute()
try await Backend.client.auth.signOut()
```

## 6. Live updates

The database broadcasts a ping on public channel `leaderboard`, event `changed`, whenever
standings may have changed. The payload carries no data — refetch the board you're showing.
Also refetch when the app returns to the foreground, and poll every 30–60 s as a fallback.

```swift
let channel = Backend.client.channel("leaderboard")
let pings = channel.broadcastStream(event: "changed")
await channel.subscribe()
Task {
    for await _ in pings { await viewModel.reloadBoards() }   // debounce ~1 s
}
// later: await Backend.client.removeChannel(channel)
```

## 7. Timer rules for a native client

- The server owns time. `start_session` stamps `started_at` with the database clock; `stop_session`
  computes minutes on the server. Never send a start time or minutes for a timer.
- Display elapsed time with a clock offset so a wrong device clock or time-zone change can't break
  it: `offset = me.serverNow - Date()` (measured right after `get_me`), then
  `elapsed = Date() + offset - activeSession.startedAt`.
- On launch / foreground, call `get_me`; if `activeSession` exists, resume showing it. Nothing is
  stored only on the phone.
- Keep the `client_request_id` for a start or a manual log until the call succeeds. Retrying with
  the same id returns the original row, so a flaky connection can't create duplicates.
  `stop_session` is safe to retry as-is.
- If Finish fails for lack of signal, remember when it was tapped and retry with `p_ended_at`.
- Show a "Still playing?" prompt at `settings.checkinReminderMinutes` (default 90) and call
  `checkin_session`. Timers still running at `settings.maxSessionMinutes` (default 180) are closed
  by the server, capped, and flagged so staff can adjust them if needed.
- Sessions count the moment they finish or are logged — there's no approval step, so don't show
  "pending" or "verification" wording. Staff can still adjust or remove a session (status
  `rejected` = removed from totals). Elapsed time isn't proof of attendance; this is a trust-based,
  for-fun pilot.

## 8. Errors

Function errors arrive as `PostgrestError` with a `message` written for players
("You already have a session running.", "That invite code didn't work…"). Show the message as-is.
Network errors (`URLError`) should show a retry state; nothing is lost because the server is the
source of truth.

## 9. App Store notes

- In-app account deletion: `delete_my_account` (required by App Review guideline 5.1.1(v)).
- Don't request, store or imply official PingPod credentials; this is a separate Morrisville
  Rewards account and not PingPod sign-in.
- Label self-reported SPINDEX ratings as **Self-reported**; only `status == "verified"` may be
  shown as verified. Never compute a SPINDEX value from minutes.
- Nicknames, crew names and stats are public only when the player opts in
  (`show_on_leaderboard`); emails are never returned by any public function.
- Physical rewards stay off until the franchisee approves terms (`settings.rewardsEnabled`).
