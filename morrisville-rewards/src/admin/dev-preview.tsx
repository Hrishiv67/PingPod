// Temporary visual harness (not shipped): renders AdminApp with sample data.
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/ui.css";
import { api } from "../lib/api";
import { ToastProvider } from "../components/ui";
import AdminApp from "./AdminApp";
import type { Me, Settings } from "../lib/types";

const settings: Settings = {
  venue_name: "PingPod Morrisville", public_app_url: "https://pingpod-morrisville-rewards.vercel.app", pilot_start: "2026-11-16", pilot_end: "2026-12-13",
  max_session_minutes: 180, checkin_reminder_minutes: 90, manual_min_minutes: 5, manual_max_minutes: 180, backdate_days: 7, daily_minutes_cap: 300,
  crew_min_size: 2, crew_max_size: 8, auto_approve_timer: false, default_board_scope: "verified", display_scope: "verified", display_rotation_seconds: 15,
  display_slides: ["minutes", "streaks", "crews", "highlights"], boards_enabled: ["minutes", "streaks", "longest", "spindex", "crews"], rewards_enabled: false, updated_at: new Date().toISOString(),
};
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
const role = (new URLSearchParams(location.search).get("role") ?? "owner") as "owner" | "staff" | "none";
const me = { server_now: iso(0), profile: { id: "me", display_name: "Hrishiv", avatar_color: "pink", show_on_leaderboard: true, show_spindex: true, hidden_by_admin: false, created_at: iso(5000), updated_at: iso(10) }, admin_role: role === "none" ? null : role, settings } as Me;
const base = { submitted_minutes: null, note: null, flags: [], auto_closed: false, last_checkin_at: null, reviewed_at: null, review_reason: null, reviewed_by_name: null, is_own: false, player_rejections: 0 };
const A = api.admin as unknown as Record<string, unknown>;
A.sessions = async (status: string) => [
  { ...base, id: "s1", user_id: "u1", display_name: "SpinDoctor", method: "timer", status: status === "active" ? "active" : "pending", minutes: 54, played_on: "2026-11-19", started_at: iso(70), ended_at: status === "active" ? null : iso(16), created_at: iso(16), player_sessions: 6 },
  { ...base, id: "s2", user_id: "u2", display_name: "Backhand Becca", method: "manual", status: "pending", minutes: 90, submitted_minutes: 90, played_on: "2026-11-18", started_at: iso(1500), ended_at: iso(1410), created_at: iso(60), note: "Played doubles with my brother after school, forgot to start the timer", flags: ["same_day_as_timer"], player_sessions: 3, player_rejections: 1 },
  { ...base, id: "s3", user_id: "u3", display_name: "TopspinTom", method: "timer", status: "pending", minutes: 180, submitted_minutes: 180, played_on: "2026-11-18", started_at: iso(1600), ended_at: iso(1420), created_at: iso(1420), flags: ["auto_closed"], auto_closed: true, player_sessions: 11 },
  { ...base, id: "s4", user_id: "me", display_name: "Hrishiv", method: "timer", status: "pending", minutes: 45, played_on: "2026-11-17", started_at: iso(3000), ended_at: iso(2955), created_at: iso(2955), is_own: true, player_sessions: 2 },
].filter((s) => status === "all" || s.status === status);
A.analytics = async () => ({ generated_at: iso(0), pilot_start: "2026-11-16", pilot_end: "2026-12-13", accounts: 14, registered_players: 13, players_with_session: 11, repeat_players_days: 6, repeat_players_weeks: 4, sessions: { counted: 37, approved: 24, pending: 13, rejected: 2, cancelled: 3, active_now: 2, timer: 26, manual: 11, auto_closed: 1 }, minutes: { approved: 1830, pending: 760, rejected: 75 }, crews: { total: 4, eligible: 3, active_this_week: 2 }, spindex: { self_reported: 2, verified: 1 }, open_requests: 1,
  weekly: [{ week_start: "2026-11-02", active_players: 3, returning_players: 0, new_signups: 4, sessions: 5, timer_sessions: 3, manual_sessions: 2, approved_minutes: 260, pending_minutes: 0, crews_with_play: 1 }, { week_start: "2026-11-09", active_players: 7, returning_players: 2, new_signups: 5, sessions: 14, timer_sessions: 10, manual_sessions: 4, approved_minutes: 820, pending_minutes: 60, crews_with_play: 2 }, { week_start: "2026-11-16", active_players: 9, returning_players: 4, new_signups: 4, sessions: 18, timer_sessions: 13, manual_sessions: 5, approved_minutes: 750, pending_minutes: 700, crews_with_play: 3 }] });
A.players = async () => [
  { id: "u1", display_name: "SpinDoctor", email: "spin.doctor.long.email.address@example.com", created_at: iso(9000), last_sign_in_at: iso(30), avatar_color: "blue", show_on_leaderboard: true, hidden_by_admin: false, hidden_reason: null, admin_role: null, sessions: 6, approved_minutes: 340, pending_minutes: 54, crew_name: "Net Gains", spindex: { rating: 1450, status: "unverified" } },
  { id: "me", display_name: "Hrishiv", email: "owner@example.com", created_at: iso(12000), last_sign_in_at: iso(2), avatar_color: "pink", show_on_leaderboard: true, hidden_by_admin: false, hidden_reason: null, admin_role: "owner", sessions: 2, approved_minutes: 60, pending_minutes: 45, crew_name: null, spindex: null },
  { id: "u9", display_name: null, email: "newbie@example.com", created_at: iso(100), last_sign_in_at: iso(100), avatar_color: null, show_on_leaderboard: null, hidden_by_admin: null, hidden_reason: null, admin_role: null, sessions: 0, approved_minutes: 0, pending_minutes: 0, crew_name: null, spindex: null },
];
A.crews = async () => [{ id: "c1", name: "Net Gains", invite_code: "K7Q2MZ4P", created_at: iso(8000), archived_at: null, hidden_by_admin: false, hidden_reason: null, owner_id: "u1", owner_name: "SpinDoctor", members: [{ user_id: "u1", display_name: "SpinDoctor", joined_at: iso(8000) }, { user_id: "u2", display_name: "Backhand Becca", joined_at: iso(7000) }], past_members: 1, week_verified_minutes: 410 }];
A.spindex = async () => [{ id: "r1", user_id: "u1", display_name: "SpinDoctor", rating: 1450, status: "unverified", source: "self_reported", player_note: "From the SPINDEX app, Nov 2026", created_at: iso(300), verified_at: null, verification_source: null, verified_by_name: null }];
A.requests = async () => [{ id: "q1", kind: "correction", message: "My timer kept running after I left — I only played about 50 minutes.", status: "open", created_at: iso(200), admin_response: null, resolved_at: null, user_id: "u3", display_name: "TopspinTom", session_id: "s3", session: { played_on: "2026-11-18", minutes: 180, status: "pending", method: "timer" } }];
A.rewards = async () => [];
A.audit = async () => [{ id: 1, action: "session.adjust", target_type: "session", target_id: "s9", details: { reason: "Left timer running", before: { status: "approved", minutes: 120 }, after: { status: "approved", minutes: 75 } }, created_at: iso(50), actor_name: "Hrishiv" }, { id: 2, action: "spindex.verify", target_type: "spindex", target_id: "r0", details: { rating: 1610, source: "Saw SPINDEX app at desk" }, created_at: iso(500), actor_name: "Joe" }];
A.staff = async () => [{ user_id: "me", role: "owner", added_at: iso(9000), display_name: "Hrishiv", email: "owner@example.com" }, { user_id: "u7", role: "staff", added_at: iso(4000), display_name: "Joe", email: "joe@example.com" }];
(api as unknown as Record<string, unknown>).publicSettings = async () => settings;

createRoot(document.getElementById("root")!).render(
  <ToastProvider><AdminApp me={me} onSignOut={() => alert("sign out")} refreshMe={async () => {}} /></ToastProvider>,
);
