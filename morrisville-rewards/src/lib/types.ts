// Shapes returned by the Supabase functions in supabase/migrations.
// Keep in sync with docs/API.md (the iOS app uses the same contract).

export type SessionStatus = "active" | "pending" | "approved" | "rejected" | "cancelled";
export type Method = "timer" | "manual";
export type Scope = "verified" | "community";
export type Period = "week" | "month" | "all";
export type Metric = "minutes" | "streaks" | "longest" | "spindex";
export type AvatarColor = "pink" | "white" | "blue" | "green" | "orange" | "purple";
export type CrewEmblem = "users" | "flame" | "bolt" | "crown" | "target" | "rocket" | "star" | "shield";
export interface CrewStyle {
  color?: AvatarColor;
  emblem?: CrewEmblem;
  motto?: string | null;
}
export type StaffRole = "owner" | "staff";

export const AVATAR_COLORS: AvatarColor[] = ["pink", "white", "blue", "green", "orange", "purple"];

export interface Profile {
  id: string;
  display_name: string;
  avatar_color: AvatarColor;
  show_on_leaderboard: boolean;
  show_spindex: boolean;
  hidden_by_admin: boolean;
  bio?: string | null;
  /** Path in the public "avatars" storage bucket; build the URL with avatarUrl(). */
  avatar_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaySession {
  id: string;
  user_id: string;
  method: Method;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  played_on: string;
  minutes: number;
  submitted_minutes: number | null;
  note: string | null;
  client_request_id: string | null;
  last_checkin_at: string | null;
  auto_closed: boolean;
  flags: string[];
  reviewed_at: string | null;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  venue_name: string;
  public_app_url: string;
  pilot_start: string | null;
  pilot_end: string | null;
  max_session_minutes: number;
  checkin_reminder_minutes: number;
  manual_min_minutes: number;
  manual_max_minutes: number;
  backdate_days: number;
  daily_minutes_cap: number;
  crew_min_size: number;
  crew_max_size: number;
  auto_approve_timer: boolean;
  default_board_scope: Scope;
  display_scope: Scope;
  display_rotation_seconds: number;
  display_slides: DisplaySlide[];
  boards_enabled: BoardKey[];
  rewards_enabled: boolean;
  /** Research survey link shown to new players and on the profile (null = off). */
  survey_url?: string | null;
  updated_at?: string;
}

export type DisplaySlide = "minutes" | "streaks" | "longest" | "crews" | "spindex" | "highlights";
export type BoardKey = "minutes" | "streaks" | "longest" | "spindex" | "crews";

export interface Stats {
  week_verified: number;
  week_pending: number;
  month_verified: number;
  month_pending: number;
  total_verified: number;
  total_pending: number;
  sessions: number;
  pending_sessions: number;
  longest_session: number;
  current_streak: number;
  longest_streak: number;
  rank_week_verified: number | null;
  rank_week_community: number | null;
  ranked_week_verified: number;
  ranked_week_community: number;
}

export interface CrewSummary {
  id: string;
  name: string;
  invite_code: string;
  is_owner: boolean;
}

export interface SpindexClaim {
  id: string;
  rating: number;
  status: "unverified" | "verified";
  source: "self_reported" | "staff_verified" | "official_integration";
  verified_at: string | null;
  created_at: string;
}

export interface Me {
  server_now: string;
  profile: Profile | null;
  admin_role?: StaffRole | null;
  /** On the staff list but still signing in with just an email: staff tools need a password first. */
  staff_needs_password?: boolean;
  active_session?: PlaySession | null;
  crew?: CrewSummary | null;
  spindex?: SpindexClaim | null;
  stats?: Stats;
  settings: Settings;
}

export interface LeaderRow {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_color: AvatarColor;
  value: number;
  secondary: number | null;
  sessions: number | null;
  detail: string | null;
  is_me: boolean;
  avatar_path?: string | null;
}

export interface CrewRow extends CrewStyle {
  rank: number;
  crew_id: string;
  name: string;
  minutes: number;
  members: number;
  contributors: number;
  avg_minutes: number;
  is_mine: boolean;
}

export interface CrewMember {
  user_id: string;
  display_name: string;
  avatar_color: AvatarColor;
  avatar_path?: string | null;
  is_owner: boolean;
  is_me: boolean;
  joined_at: string;
  minutes: number;
}

export interface MyCrew extends CrewStyle {
  id: string;
  name: string;
  invite_code: string;
  is_owner: boolean;
  created_at: string;
  hidden_by_admin: boolean;
  min_members: number;
  max_members: number;
  rank: number | null;
  crews_ranked: number;
  total_minutes: number;
  members: CrewMember[];
}

export interface CrewPreview extends CrewStyle {
  name: string;
  members: number;
  max_members: number;
}

export interface PlayerCard {
  user_id: string;
  display_name: string;
  avatar_color: AvatarColor;
  avatar_path: string | null;
  bio: string | null;
  member_since: string;
  is_me: boolean;
  crew: { name: string; color: AvatarColor; emblem: CrewEmblem; motto: string | null } | null;
  week_minutes: number;
  total_minutes: number;
  sessions: number;
  current_streak: number;
  longest_streak: number;
  rank_week: number | null;
  spindex: { rating: number; verified: boolean } | null;
}

export interface Achievement {
  code: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  earned_at: string | null;
}

export interface SupportRequest {
  id: string;
  kind: "correction" | "privacy" | "deletion" | "other";
  session_id: string | null;
  message: string;
  status: "open" | "resolved" | "dismissed";
  admin_response: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Reward {
  id: string;
  title: string;
  description: string | null;
  criteria: string | null;
  enabled: boolean;
  approval_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisplayPlayer {
  rank: number;
  display_name: string;
  avatar_color: AvatarColor;
  avatar_path?: string | null;
  value: number;
  sessions?: number;
  secondary?: number;
  detail?: string;
}

export interface DisplayCrew extends CrewStyle {
  rank: number;
  name: string;
  minutes: number;
  members: number;
  avg_minutes: number;
}

export interface DisplayData {
  generated_at: string;
  scope: Scope;
  rotation_seconds: number;
  slides: DisplaySlide[];
  public_app_url: string;
  venue_name: string;
  week_start: string;
  minutes: DisplayPlayer[];
  longest: DisplayPlayer[];
  streaks: DisplayPlayer[];
  /** Highest current SPINDEX ratings; `detail` is "verified" or "self_reported". Older backends omit it. */
  spindex?: DisplayPlayer[];
  crews: DisplayCrew[];
  highlights: {
    players: number;
    minutes: number;
    sessions: number;
    new_players: number;
    longest: { display_name: string; minutes: number } | null;
    most_sessions: { display_name: string; sessions: number } | null;
    top_crew: { name: string; minutes: number } | null;
    top_spindex?: { display_name: string; rating: number } | null;
    active_crews: number;
  };
}

// ── Staff ────────────────────────────────────────────────────────────
export interface AdminSession {
  id: string;
  user_id: string;
  display_name: string;
  method: Method;
  status: SessionStatus;
  minutes: number;
  submitted_minutes: number | null;
  played_on: string;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  flags: string[];
  auto_closed: boolean;
  last_checkin_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  review_reason: string | null;
  reviewed_by_name: string | null;
  is_own: boolean;
  player_sessions: number;
  player_rejections: number;
}

export interface AdminPlayer {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  avatar_color: AvatarColor | null;
  avatar_path?: string | null;
  bio?: string | null;
  show_on_leaderboard: boolean | null;
  hidden_by_admin: boolean | null;
  hidden_reason: string | null;
  admin_role: StaffRole | null;
  sessions: number;
  approved_minutes: number;
  pending_minutes: number;
  crew_name: string | null;
  spindex: { rating: number; status: string } | null;
}

export interface AdminCrew extends CrewStyle {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  archived_at: string | null;
  hidden_by_admin: boolean;
  hidden_reason: string | null;
  owner_id: string | null;
  owner_name: string | null;
  members: { user_id: string; display_name: string; joined_at: string }[];
  past_members: number;
  week_verified_minutes: number | null;
}

export interface AdminSpindex {
  id: string;
  user_id: string;
  display_name: string;
  rating: number;
  status: "unverified" | "verified" | "rejected" | "superseded";
  source: string;
  player_note: string | null;
  created_at: string;
  verified_at: string | null;
  verification_source: string | null;
  verified_by_name: string | null;
}

export interface AdminRequest {
  id: string;
  kind: SupportRequest["kind"];
  message: string;
  status: SupportRequest["status"];
  created_at: string;
  admin_response: string | null;
  resolved_at: string | null;
  user_id: string;
  display_name: string | null;
  session_id: string | null;
  session: { played_on: string; minutes: number; status: SessionStatus; method: Method } | null;
}

export interface WeeklyRow {
  week_start: string;
  active_players: number;
  returning_players: number;
  new_signups: number;
  sessions: number;
  timer_sessions: number;
  manual_sessions: number;
  approved_minutes: number;
  pending_minutes: number;
  crews_with_play: number;
}

export interface Analytics {
  generated_at: string;
  pilot_start: string | null;
  pilot_end: string | null;
  accounts: number;
  registered_players: number;
  players_with_session: number;
  repeat_players_days: number;
  repeat_players_weeks: number;
  sessions: {
    counted: number;
    approved: number;
    pending: number;
    rejected: number;
    cancelled: number;
    active_now: number;
    timer: number;
    manual: number;
    auto_closed: number;
  };
  minutes: { approved: number; pending: number; rejected: number };
  crews: { total: number; eligible: number; active_this_week: number };
  spindex: { self_reported: number; verified: number };
  open_requests: number;
  weekly: WeeklyRow[];
}

export interface AuditEntry {
  id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
}

export interface StaffMember {
  user_id: string;
  role: StaffRole;
  added_at: string;
  display_name: string | null;
  email: string | null;
}
