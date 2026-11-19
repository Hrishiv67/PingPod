import { createClient, type User } from "@supabase/supabase-js";
import type { Ranking, Session, TeamRanking } from "./metrics";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isConfigured = Boolean(url && key);
export const supabase = isConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export type Profile = {
  id: string;
  display_name: string;
  show_on_leaderboard: boolean;
};
export type Team = {
  id: string;
  name: string;
  invite_code: string;
  owner_id?: string;
};
export type PendingSession = {
  id: string;
  display_name: string;
  minutes: number;
  started_at: string;
  method: string;
};

function assertBackend() {
  if (!supabase)
    throw new Error("Connect a Supabase project to enable real accounts.");
  return supabase;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("No result returned.");
  return data;
}

export async function getMyState(user: User) {
  const db = assertBackend();
  const [profile, sessions, membership] = await Promise.all([
    db.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    db
      .from("play_sessions")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(150),
    db
      .from("team_memberships")
      .select("team_id, teams(id, name, invite_code, owner_id)")
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle(),
  ]);
  if (profile.error) throw profile.error;
  if (sessions.error) throw sessions.error;
  if (membership.error) throw membership.error;
  const teamRelation = membership.data?.teams;
  const team = Array.isArray(teamRelation) ? teamRelation[0] : teamRelation;
  return {
    profile: profile.data as Profile | null,
    sessions: (sessions.data ?? []) as Session[],
    team: (team ?? null) as Team | null,
  };
}

export async function saveProfile(
  user: User,
  displayName: string,
  show = true,
) {
  const db = assertBackend();
  const clean = displayName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,21}$/.test(clean)) {
    throw new Error("Use 2–22 characters: letters, numbers, spaces, _ . or -");
  }
  const { data, error } = await db
    .from("profiles")
    .upsert({
      id: user.id,
      display_name: clean,
      show_on_leaderboard: show,
    })
    .select()
    .single();
  return unwrap(data as Profile | null, error);
}

export async function startSession(): Promise<Session> {
  const { data, error } = await assertBackend().rpc("start_session");
  return unwrap(data as Session | null, error);
}

export async function stopSession(id: string): Promise<Session> {
  const { data, error } = await assertBackend().rpc("stop_session", {
    p_id: id,
  });
  return unwrap(data as Session | null, error);
}

export async function logSession(
  day: string,
  minutes: number,
): Promise<Session> {
  const { data, error } = await assertBackend().rpc("log_session", {
    p_day: day,
    p_minutes: minutes,
  });
  return unwrap(data as Session | null, error);
}

export async function createTeam(name: string): Promise<Team> {
  const { data, error } = await assertBackend().rpc("create_team", {
    p_name: name,
  });
  return unwrap(data as Team | null, error);
}

export async function joinTeam(code: string): Promise<Team> {
  const { data, error } = await assertBackend().rpc("join_team", {
    p_code: code,
  });
  return unwrap(data as Team | null, error);
}

export async function leaveTeam() {
  const { error } = await assertBackend().rpc("leave_team");
  if (error) throw new Error(error.message);
}

export async function getBoards(period: "week" | "month" | "all") {
  const db = assertBackend();
  const [players, teams] = await Promise.all([
    db.rpc("get_leaderboard", { p_period: period }),
    db.rpc("get_team_leaderboard", { p_period: period }),
  ]);
  if (players.error) throw new Error(players.error.message);
  if (teams.error) throw new Error(teams.error.message);
  return {
    players: (players.data ?? []) as Ranking[],
    teams: (teams.data ?? []) as TeamRanking[],
  };
}

export async function getAdminStatus(): Promise<boolean> {
  const { data, error } = await assertBackend().rpc("is_pilot_admin");
  return unwrap(data as boolean | null, error);
}

export async function getPending(): Promise<PendingSession[]> {
  const { data, error } = await assertBackend().rpc("admin_pending_sessions");
  return unwrap(data as PendingSession[] | null, error);
}

export async function reviewSession(id: string, approved: boolean) {
  const { error } = await assertBackend().rpc("review_session", {
    p_id: id,
    p_approve: approved,
  });
  if (error) throw new Error(error.message);
}
