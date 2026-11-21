import type { GeoFix } from "./geo";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type {
  Achievement,
  AdminCrew,
  AdminPlayer,
  AdminRequest,
  AdminSession,
  AdminSpindex,
  Analytics,
  AuditEntry,
  AvatarColor,
  CrewEmblem,
  CrewPreview,
  CrewRow,
  DisplayData,
  LeaderRow,
  Me,
  Metric,
  MyCrew,
  Period,
  PlaySession,
  PlayerCard,
  Profile,
  Reward,
  Scope,
  Settings,
  StaffMember,
  StaffRole,
  SupportRequest,
} from "./types";
import { demoApi } from "./demo";
import { emailKey, normalizeEmail } from "./emailKey";
import { squareJpeg } from "./image";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Public URL for a profile photo path (demo mode stores the picture itself as a data URL). */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("data:") || path.startsWith("https://")) return path;
  return url ? `${url.replace(/\/$/, "")}/storage/v1/object/public/avatars/${path}` : null;
}

export const isConfigured = Boolean(url && key);

/** Player/staff client: keeps the login in this browser between visits. */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "pingpod-morrisville-auth",
      },
    })
  : null;

/** Public screens (iPad board, poster): never carries anyone's login. */
export const publicClient: SupabaseClient | null = isConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "pingpod-morrisville-public",
      },
    })
  : null;

// ── Errors ─────────────────────────────────────────────────────────────
export class AppError extends Error {
  offline: boolean;
  constructor(message: string, offline = false) {
    super(message);
    this.offline = offline;
  }
}

const OFFLINE_PATTERN = /failed to fetch|load failed|networkerror|network request failed|fetch failed|timed? ?out/i;

const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, "That password doesn't match this email. Try again, or ask the front desk."],
  [/already registered|already been registered|user already exists/i, "There's already an account with that email. Sign in instead."],
  [/email not confirmed/i, "Confirm your email first — check your inbox for the link."],
  [/error sending (confirmation|recovery)? ?email|sending email/i, "We couldn't send the email right now. Please ask the front desk for help."],
  [/password should be at least/i, "Use at least 6 characters for your password."],
  [/unable to validate email|invalid email|email address .* is invalid/i, "That email address doesn't look right."],
  [/jwt expired|invalid jwt|refresh token/i, "Your login expired. Please sign in again."],
  [/signups not allowed/i, "New sign-ups are paused right now. Ask the front desk."],
];

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message: unknown }).message)
        : "Something went wrong. Try again.";
  if (OFFLINE_PATTERN.test(raw)) return new AppError("You're offline. Check your connection and try again.", true);
  for (const [pattern, text] of AUTH_MESSAGES) if (pattern.test(raw)) return new AppError(text);
  if (/permission denied|not authorized/i.test(raw)) return new AppError("You don't have access to that.");
  return new AppError(raw || "Something went wrong. Try again.");
}

export function errorText(err: unknown): string {
  return toAppError(err).message;
}

function need(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new AppError("This preview isn't connected to the live database.");
  return client;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>, client = supabase): Promise<T> {
  try {
    const { data, error } = await need(client).rpc(fn, args ?? {});
    if (error) throw error;
    return data as T;
  } catch (err) {
    throw toAppError(err);
  }
}

// ── Auth ───────────────────────────────────────────────────────────────
export type AuthUser = { id: string; email: string | null };
const toAuthUser = (u: User | null | undefined): AuthUser | null => (u ? { id: u.id, email: u.email ?? null } : null);

export type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "PASSWORD_RECOVERY" | "OTHER";

export interface ProfileInput {
  display_name: string;
  avatar_color: AvatarColor;
  show_on_leaderboard: boolean;
  show_spindex: boolean;
}

export interface LogInput {
  played_on: string;
  minutes: number;
  note?: string;
  client_request_id: string;
}

export interface Api {
  mode: "live" | "demo";
  getUser(): Promise<AuthUser | null>;
  onAuthChange(cb: (event: AuthEvent, user: AuthUser | null) => void): () => void;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  /** Email-only sign-in: signs in or creates the account. "password" = a staff account (staff keep a password). */
  enterWithEmail(email: string): Promise<"in" | "password">;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;

  getMe(): Promise<Me>;
  saveProfile(input: ProfileInput): Promise<Profile>;
  /** `at`: the phone's location, needed when the venue's timer location check is on (never stored). */
  startSession(clientRequestId: string, at?: GeoFix | null): Promise<PlaySession>;
  checkinSession(id: string): Promise<PlaySession>;
  stopSession(id: string, endedAt?: string): Promise<PlaySession>;
  cancelSession(id: string): Promise<PlaySession>;
  logSession(input: LogInput): Promise<PlaySession>;
  mySessions(limit?: number): Promise<PlaySession[]>;
  myRequests(): Promise<SupportRequest[]>;
  submitRequest(kind: SupportRequest["kind"], message: string, sessionId?: string | null): Promise<void>;
  achievements(): Promise<Achievement[]>;
  submitSpindex(rating: number, note?: string): Promise<void>;
  removeSpindex(): Promise<void>;
  deleteAccount(): Promise<void>;
  /** Removes one of your own finished sessions; it stops counting everywhere. */
  removeSession(id: string): Promise<void>;
  saveBio(bio: string): Promise<void>;
  /** Weekly Rally goal (days per week + minutes per week); nulls clear it. */
  saveWeeklyGoals(days: number | null, minutes: number | null): Promise<void>;
  /** Research survey answers; saved anonymously (only "finished" is kept on the profile). */
  submitSurvey(answers: Record<string, unknown>): Promise<void>;
  /** Resizes the picture on the phone (square, small JPEG), uploads it and sets it as your photo. */
  uploadAvatar(file: Blob): Promise<void>;
  removeAvatar(): Promise<void>;
  playerCard(userId: string): Promise<PlayerCard>;
  /** Optional email verification: email a one-time code (and link) to the signed-in player. */
  sendEmailCode(): Promise<void>;
  verifyEmailCode(code: string): Promise<void>;
  /** After tapping the emailed link: marks the email verified if this session came from it. */
  confirmEmailFromLink(): Promise<boolean>;

  myCrew(period: Period, scope: Scope): Promise<MyCrew | null>;
  previewCrew(code: string): Promise<CrewPreview | null>;
  createCrew(name: string): Promise<void>;
  joinCrew(code: string): Promise<void>;
  leaveCrew(): Promise<void>;
  renameCrew(name: string): Promise<void>;
  regenerateCrewCode(): Promise<void>;
  transferCrew(userId: string): Promise<void>;
  removeCrewMember(userId: string): Promise<void>;
  setCrewStyle(style: { color: AvatarColor; emblem: CrewEmblem; motto: string }): Promise<void>;

  leaderboard(metric: Metric, period: Period, scope: Scope, limit?: number): Promise<LeaderRow[]>;
  crewLeaderboard(period: Period, scope: Scope, limit?: number): Promise<CrewRow[]>;
  displayData(): Promise<DisplayData>;
  /** Boards for the iPad, always fetched signed-out (public data only). */
  publicBoard(metric: Metric, period: Period, scope: Scope, limit?: number): Promise<LeaderRow[]>;
  publicCrewBoard(period: Period, scope: Scope, limit?: number): Promise<CrewRow[]>;
  publicSettings(): Promise<Settings>;
  /** Temporary "Players" board for the in-store screen: everyone signed up, newest first (empty when off). */
  joinedPlayers(limit?: number): Promise<{ user_id: string; display_name: string; avatar_color: AvatarColor; joined_at: string }[]>;
  rewards(): Promise<Reward[]>;
  /** Fires when standings may have changed (Supabase Realtime broadcast). */
  subscribeBoards(onChange: () => void): () => void;

  admin: AdminApi;
}

export type SessionAction = "approve" | "reject" | "adjust" | "reopen";
export type PlayerAction = "hide" | "unhide" | "rename" | "clear_photo" | "clear_bio";
export type CrewAction = "rename" | "hide" | "unhide" | "archive" | "transfer" | "remove_member" | "clear_motto";
export type ExportKind = "weekly" | "players" | "sessions";

export interface AdminApi {
  claim(code: string): Promise<{ role: StaffRole }>;
  surveyResponses(): Promise<{ id: string; answers: Record<string, unknown>; created_at: string }[]>;
  sessions(status: string, search?: string): Promise<AdminSession[]>;
  reviewSession(id: string, action: SessionAction, minutes?: number | null, reason?: string | null): Promise<PlaySession>;
  bulkApprove(ids: string[]): Promise<number>;
  players(search?: string): Promise<AdminPlayer[]>;
  moderatePlayer(userId: string, action: PlayerAction, value?: string | null, reason?: string | null): Promise<void>;
  deletePlayer(userId: string, reason: string): Promise<void>;
  crews(): Promise<AdminCrew[]>;
  moderateCrew(crewId: string, action: CrewAction, value?: string | null, reason?: string | null): Promise<void>;
  spindex(status: string): Promise<AdminSpindex[]>;
  reviewSpindex(id: string, action: "verify" | "reject" | "unverify", source?: string | null): Promise<void>;
  requests(status: string): Promise<AdminRequest[]>;
  resolveRequest(id: string, status: "resolved" | "dismissed" | "open", response?: string | null): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  rewards(): Promise<Reward[]>;
  saveReward(reward: {
    id: string | null;
    title: string;
    description: string;
    criteria: string;
    enabled: boolean;
    approval_note: string;
  }): Promise<Reward>;
  staff(): Promise<StaffMember[]>;
  setStaff(userId: string, role: StaffRole | null): Promise<void>;
  analytics(): Promise<Analytics>;
  exportRows(kind: ExportKind): Promise<Record<string, unknown>[]>;
  audit(limit?: number): Promise<AuditEntry[]>;
}

// ── Live implementation (Supabase) ─────────────────────────────────────
const live: Api = {
  mode: "live",

  async getUser() {
    const { data } = await need(supabase).auth.getSession();
    return toAuthUser(data.session?.user);
  },
  onAuthChange(cb) {
    const { data } = need(supabase).auth.onAuthStateChange((event, session) => {
      const mapped: AuthEvent =
        event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY" ? event : "OTHER";
      cb(mapped, toAuthUser(session?.user));
    });
    return () => data.subscription.unsubscribe();
  },
  async signUp(email, password) {
    try {
      const { data, error } = await need(supabase).auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      // Supabase hides "already registered" behind an empty identities list when confirmation is on.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new AppError("There's already an account with that email. Sign in instead.");
      }
      return { needsConfirmation: !data.session };
    } catch (err) {
      throw toAppError(err);
    }
  },
  async signIn(email, password) {
    try {
      const { error } = await need(supabase).auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch (err) {
      throw toAppError(err);
    }
  },
  async enterWithEmail(email) {
    const e = normalizeEmail(email);
    try {
      const sb = need(supabase);
      const key = await emailKey(e);
      const { error } = await sb.auth.signInWithPassword({ email: e, password: key });
      if (!error) return "in";
      if (!/invalid login credentials/i.test(error.message)) throw error;
      const { data, error: upError } = await sb.auth.signUp({
        email: e,
        password: key,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (upError) {
        if (/already registered|already been registered|user already exists/i.test(upError.message)) return "password";
        throw upError;
      }
      // Supabase hides "already registered" behind an empty identities list when confirmation is on.
      if (data.user && data.user.identities && data.user.identities.length === 0) return "password";
      if (!data.session) throw new AppError("Check your inbox for a link to finish signing up, then come back.");
      return "in";
    } catch (err) {
      throw toAppError(err);
    }
  },
  async signOut() {
    await need(supabase).auth.signOut({ scope: "local" });
  },
  async sendPasswordReset(email) {
    try {
      const { error } = await need(supabase).auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    } catch (err) {
      throw toAppError(err);
    }
  },
  async updatePassword(password) {
    try {
      const { error } = await need(supabase).auth.updateUser({ password });
      if (error) throw error;
    } catch (err) {
      throw toAppError(err);
    }
  },

  getMe: () => rpc<Me>("get_me"),
  saveProfile: (p) =>
    rpc<Profile>("save_profile", {
      p_display_name: p.display_name,
      p_avatar_color: p.avatar_color,
      p_show_on_leaderboard: p.show_on_leaderboard,
      p_show_spindex: p.show_spindex,
    }),
  startSession: (id, at) =>
    rpc<PlaySession>("start_session", {
      p_client_request_id: id,
      ...(at ? { p_lat: at.lat, p_lng: at.lng, p_accuracy: at.accuracy } : {}),
    }),
  checkinSession: (id) => rpc<PlaySession>("checkin_session", { p_id: id }),
  stopSession: (id, endedAt) => rpc<PlaySession>("stop_session", { p_id: id, p_ended_at: endedAt ?? null }),
  cancelSession: (id) => rpc<PlaySession>("cancel_session", { p_id: id }),
  logSession: (i) =>
    rpc<PlaySession>("log_session", {
      p_played_on: i.played_on,
      p_minutes: i.minutes,
      p_note: i.note ?? null,
      p_client_request_id: i.client_request_id,
    }),
  async mySessions(limit = 100) {
    try {
      const { data, error } = await need(supabase)
        .from("play_sessions")
        .select("*")
        .neq("status", "active")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as PlaySession[];
    } catch (err) {
      throw toAppError(err);
    }
  },
  async myRequests() {
    try {
      const { data, error } = await need(supabase)
        .from("support_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SupportRequest[];
    } catch (err) {
      throw toAppError(err);
    }
  },
  submitRequest: async (kind, message, sessionId) => {
    await rpc("submit_request", { p_kind: kind, p_message: message, p_session_id: sessionId ?? null });
  },
  achievements: () => rpc<Achievement[]>("get_my_achievements"),
  submitSpindex: async (rating, note) => {
    await rpc("submit_spindex", { p_rating: rating, p_note: note ?? null });
  },
  removeSpindex: async () => {
    await rpc("remove_spindex");
  },
  deleteAccount: async () => {
    // Remove photo files first (best effort), then the account and everything in it.
    try {
      const sb = need(supabase);
      const { data } = await sb.auth.getUser();
      if (data.user) {
        const { data: files } = await sb.storage.from("avatars").list(data.user.id);
        if (files?.length) await sb.storage.from("avatars").remove(files.map((f) => `${data.user!.id}/${f.name}`));
      }
    } catch {
      /* the account is still deleted below */
    }
    await rpc("delete_my_account");
    await need(supabase).auth.signOut({ scope: "local" });
  },
  removeSession: async (id) => {
    await rpc("remove_my_session", { p_id: id });
  },
  saveBio: async (bio) => {
    await rpc("save_bio", { p_bio: bio.trim() || null });
  },
  submitSurvey: async (answers) => {
    await rpc("submit_survey", { p_answers: answers });
  },
  saveWeeklyGoals: async (days, minutes) => {
    await rpc("save_weekly_goals", { p_days: days, p_minutes: minutes });
  },
  async uploadAvatar(file) {
    try {
      const sb = need(supabase);
      const { data } = await sb.auth.getUser();
      if (!data.user) throw new AppError("Sign in again to change your photo.");
      const blob = await squareJpeg(file);
      const path = `${data.user.id}/${Date.now().toString(36)}.jpg`;
      const { error } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      await rpc("set_avatar", { p_path: path });
      // Tidy up older photos (best effort).
      const { data: files } = await sb.storage.from("avatars").list(data.user.id);
      const old = (files ?? []).map((f) => `${data.user!.id}/${f.name}`).filter((p) => p !== path);
      if (old.length) await sb.storage.from("avatars").remove(old);
    } catch (err) {
      throw toAppError(err);
    }
  },
  async removeAvatar() {
    await rpc("set_avatar", { p_path: null });
    try {
      const sb = need(supabase);
      const { data } = await sb.auth.getUser();
      if (data.user) {
        const { data: files } = await sb.storage.from("avatars").list(data.user.id);
        if (files?.length) await sb.storage.from("avatars").remove(files.map((f) => `${data.user!.id}/${f.name}`));
      }
    } catch {
      /* the photo is already off the profile */
    }
  },
  playerCard: (userId) => rpc<PlayerCard>("get_player_card", { p_user_id: userId }),
  async sendEmailCode() {
    try {
      const sb = need(supabase);
      const { data } = await sb.auth.getUser();
      if (!data.user?.email) throw new AppError("Sign in again first.");
      const { error } = await sb.auth.signInWithOtp({
        email: data.user.email,
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
    } catch (err) {
      throw toAppError(err);
    }
  },
  async verifyEmailCode(code) {
    try {
      const sb = need(supabase);
      const { data } = await sb.auth.getUser();
      if (!data.user?.email) throw new AppError("Sign in again first.");
      const { error } = await sb.auth.verifyOtp({ email: data.user.email, token: code.trim(), type: "email" });
      if (error) throw error;
    } catch (err) {
      const e = toAppError(err);
      throw /expired|invalid/i.test(e.message) ? new AppError("That code didn't work. Check it or send a new one.") : e;
    }
    await rpc("confirm_email_verified");
  },
  async confirmEmailFromLink() {
    try {
      const { data } = await need(supabase).auth.getSession();
      const token = data.session?.access_token;
      if (!token) return false;
      const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
        amr?: { method: string; timestamp: number }[];
      };
      const fresh = (claims.amr ?? []).some(
        (a) => (a.method === "otp" || a.method === "magiclink") && a.timestamp > Date.now() / 1000 - 3600,
      );
      if (!fresh) return false;
      await rpc("confirm_email_verified");
      return true;
    } catch {
      return false;
    }
  },

  myCrew: (period, scope) => rpc<MyCrew | null>("get_my_crew", { p_period: period, p_scope: scope }),
  previewCrew: (code) => rpc<CrewPreview | null>("preview_crew", { p_code: code }, supabase ?? publicClient),
  createCrew: async (name) => {
    await rpc("create_crew", { p_name: name });
  },
  joinCrew: async (code) => {
    await rpc("join_crew", { p_code: code });
  },
  leaveCrew: async () => {
    await rpc("leave_crew");
  },
  renameCrew: async (name) => {
    await rpc("rename_crew", { p_name: name });
  },
  regenerateCrewCode: async () => {
    await rpc("regenerate_crew_code");
  },
  transferCrew: async (userId) => {
    await rpc("transfer_crew", { p_user_id: userId });
  },
  removeCrewMember: async (userId) => {
    await rpc("remove_crew_member", { p_user_id: userId });
  },
  setCrewStyle: async ({ color, emblem, motto }) => {
    await rpc("set_crew_style", { p_color: color, p_emblem: emblem, p_motto: motto.trim() || null });
  },

  leaderboard: (metric, period, scope, limit = 50) =>
    rpc<LeaderRow[]>("get_leaderboard", { p_metric: metric, p_period: period, p_scope: scope, p_limit: limit }),
  crewLeaderboard: (period, scope, limit = 50) =>
    rpc<CrewRow[]>("get_crew_leaderboard", { p_period: period, p_scope: scope, p_limit: limit }),
  displayData: () => rpc<DisplayData>("get_display_data", {}, publicClient),
  publicBoard: (metric, period, scope, limit = 50) =>
    rpc<LeaderRow[]>("get_leaderboard", { p_metric: metric, p_period: period, p_scope: scope, p_limit: limit }, publicClient),
  joinedPlayers: (limit = 50) => rpc("get_joined_players", { p_limit: limit }, publicClient),
  publicCrewBoard: (period, scope, limit = 50) =>
    rpc<CrewRow[]>("get_crew_leaderboard", { p_period: period, p_scope: scope, p_limit: limit }, publicClient),
  async publicSettings() {
    try {
      const { data, error } = await need(publicClient).from("pilot_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as Settings;
    } catch (err) {
      throw toAppError(err);
    }
  },
  async rewards() {
    try {
      const { data, error } = await need(supabase ?? publicClient).from("rewards").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as Reward[];
    } catch (err) {
      throw toAppError(err);
    }
  },
  subscribeBoards(onChange) {
    const client = need(publicClient);
    const channel = client
      .channel("leaderboard")
      .on("broadcast", { event: "changed" }, () => onChange())
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  },

  admin: {
    claim: (code) => rpc<{ role: StaffRole }>("admin_claim", { p_code: code }),
    surveyResponses: () => rpc("admin_survey_export"),
    sessions: (status, search) =>
      rpc<AdminSession[]>("admin_list_sessions", { p_status: status, p_search: search || null, p_limit: 300 }),
    reviewSession: (id, action, minutes, reason) =>
      rpc<PlaySession>("admin_review_session", {
        p_id: id,
        p_action: action,
        p_minutes: minutes ?? null,
        p_reason: reason ?? null,
      }),
    bulkApprove: (ids) => rpc<number>("admin_bulk_approve", { p_ids: ids }),
    players: (search) => rpc<AdminPlayer[]>("admin_list_players", { p_search: search || null }),
    moderatePlayer: async (userId, action, value, reason) => {
      await rpc("admin_moderate_player", {
        p_user_id: userId,
        p_action: action,
        p_value: value ?? null,
        p_reason: reason ?? null,
      });
    },
    deletePlayer: async (userId, reason) => {
      await rpc("admin_delete_player", { p_user_id: userId, p_reason: reason });
    },
    crews: () => rpc<AdminCrew[]>("admin_list_crews"),
    moderateCrew: async (crewId, action, value, reason) => {
      await rpc("admin_moderate_crew", {
        p_crew_id: crewId,
        p_action: action,
        p_value: value ?? null,
        p_reason: reason ?? null,
      });
    },
    spindex: (status) => rpc<AdminSpindex[]>("admin_list_spindex", { p_status: status }),
    reviewSpindex: async (id, action, source) => {
      await rpc("admin_review_spindex", { p_id: id, p_action: action, p_source: source ?? null });
    },
    requests: (status) => rpc<AdminRequest[]>("admin_list_requests", { p_status: status }),
    resolveRequest: async (id, status, response) => {
      await rpc("admin_resolve_request", { p_id: id, p_status: status, p_response: response ?? null });
    },
    updateSettings: (patch) => rpc<Settings>("admin_update_settings", { p_patch: patch }),
    rewards: () => rpc<Reward[]>("admin_list_rewards"),
    saveReward: (r) =>
      rpc<Reward>("admin_save_reward", {
        p_id: r.id,
        p_title: r.title,
        p_description: r.description,
        p_criteria: r.criteria,
        p_enabled: r.enabled,
        p_approval_note: r.approval_note,
      }),
    staff: () => rpc<StaffMember[]>("admin_list_staff"),
    setStaff: async (userId, role) => {
      await rpc("admin_set_staff", { p_user_id: userId, p_role: role });
    },
    analytics: () => rpc<Analytics>("admin_analytics"),
    exportRows: (kind) => rpc<Record<string, unknown>[]>("admin_export", { p_kind: kind }),
    audit: (limit = 200) => rpc<AuditEntry[]>("admin_audit_log", { p_limit: limit }),
  },
};


/** The single API the UI uses. Live when Supabase env vars exist; otherwise the labeled demo. */
export const api: Api = isConfigured ? live : demoApi;
