import type { Profile, Team } from "./api";
import {
  dayKey,
  type Ranking,
  type Session,
  type TeamRanking,
  totalMinutes,
} from "./metrics";

const USER_ID = "demo-you";
const KEY = "pingpod-morrisville-demo-v1";

type DemoState = { profile: Profile; sessions: Session[]; team: Team | null };

const defaults: DemoState = {
  profile: { id: USER_ID, display_name: "You", show_on_leaderboard: true },
  sessions: [],
  team: null,
};

function read(): DemoState {
  try {
    const value = localStorage.getItem(KEY);
    return value
      ? { ...defaults, ...(JSON.parse(value) as DemoState) }
      : structuredClone(defaults);
  } catch {
    return structuredClone(defaults);
  }
}

function write(next: DemoState) {
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("pingpod-demo-update"));
}

export const demo = {
  get: read,
  saveProfile(display_name: string, show_on_leaderboard: boolean) {
    const next = read();
    next.profile = { ...next.profile, display_name, show_on_leaderboard };
    write(next);
  },
  start(): Session {
    const next = read();
    if (next.sessions.some((s) => s.status === "active"))
      throw new Error("You already have an active session.");
    const session: Session = {
      id: crypto.randomUUID(),
      user_id: USER_ID,
      started_at: new Date().toISOString(),
      ended_at: null,
      minutes: 0,
      method: "timer",
      status: "active",
    };
    next.sessions.unshift(session);
    write(next);
    return session;
  },
  stop(id: string): Session {
    const next = read();
    const session = next.sessions.find(
      (s) => s.id === id && s.status === "active",
    );
    if (!session) throw new Error("No active session found.");
    const now = new Date();
    session.ended_at = now.toISOString();
    session.minutes = Math.min(
      180,
      Math.floor(
        (now.getTime() - new Date(session.started_at).getTime()) / 60000,
      ),
    );
    session.status = "pending";
    write(next);
    return session;
  },
  log(day: string, minutes: number): Session {
    if (minutes < 5 || minutes > 180)
      throw new Error("Choose between 5 and 180 minutes.");
    const next = read();
    const session: Session = {
      id: crypto.randomUUID(),
      user_id: USER_ID,
      started_at: new Date(`${day}T17:00:00Z`).toISOString(),
      ended_at: new Date(
        new Date(`${day}T17:00:00Z`).getTime() + minutes * 60000,
      ).toISOString(),
      minutes,
      method: "manual",
      status: "pending",
    };
    next.sessions.unshift(session);
    write(next);
    return session;
  },
  createTeam(name: string) {
    const next = read();
    next.team = {
      id: crypto.randomUUID(),
      name,
      invite_code: "DEMO2027",
      owner_id: USER_ID,
    };
    write(next);
    return next.team;
  },
  joinTeam(code: string) {
    if (code.toUpperCase() !== "DEMO2027")
      throw new Error("In preview, use invite code DEMO2027.");
    return this.createTeam("The Spin Doctors");
  },
  leaveTeam() {
    const next = read();
    next.team = null;
    write(next);
  },
  boards(period: "week" | "month" | "all"): {
    players: Ranking[];
    teams: TeamRanking[];
  } {
    const next = read();
    const today = new Date();
    const matching = next.sessions.filter((s) => {
      if (s.status === "active" || s.status === "rejected") return false;
      if (period === "all") return true;
      const current = dayKey(today);
      const date = dayKey(new Date(s.started_at));
      if (period === "month") return date.slice(0, 7) === current.slice(0, 7);
      const difference = Math.floor(
        (today.getTime() - new Date(s.started_at).getTime()) / 86400000,
      );
      return difference <= 7;
    });
    const mine = totalMinutes(matching);
    const others: Ranking[] = [
      { id: "demo-a", display_name: "SpinMaster", minutes: 420, sessions: 8 },
      { id: "demo-b", display_name: "TopspinTim", minutes: 345, sessions: 6 },
      { id: "demo-c", display_name: "RallyQueen", minutes: 280, sessions: 5 },
      { id: "demo-d", display_name: "PaddlePro", minutes: 180, sessions: 3 },
    ];
    const players = [
      {
        id: USER_ID,
        display_name: next.profile.display_name,
        minutes: mine,
        sessions: matching.length,
      },
      ...others,
    ].sort((a, b) => b.minutes - a.minutes);
    const teams: TeamRanking[] = [
      { id: "demo-t1", name: "The Net Ninjas", minutes: 980, members: 5 },
      { id: "demo-t2", name: "Paddle Collective", minutes: 760, members: 4 },
      { id: "demo-t3", name: "Sunday Smash", minutes: 510, members: 3 },
      ...(next.team
        ? [
            {
              id: next.team.id,
              name: next.team.name,
              minutes: mine,
              members: 1,
            },
          ]
        : []),
    ].sort((a, b) => b.minutes - a.minutes);
    return { players, teams };
  },
};
