// In-browser DEMO backend. Used only when VITE_SUPABASE_* env vars are missing
// (local development and offline presentations). It mirrors the database rules in
// supabase/migrations so the product can be shown honestly, but nothing here is shared
// between devices and every sample competitor is labeled "Sample · …".
import type { AdminApi, Api, AuthEvent, AuthUser, LogInput, ProfileInput } from "./api";
import type {
  Achievement,
  AvatarColor,
  CrewMember,
  CrewPreview,
  CrewRow,
  DisplayData,
  LeaderRow,
  Me,
  Metric,
  MyCrew,
  Period,
  PlaySession,
  Profile,
  Scope,
  Settings,
  SpindexClaim,
  Stats,
  SupportRequest,
} from "./types";
import { VENUE_TZ, addDays, venueDate, weekStart } from "./time.ts";

const STORAGE_KEY = "pingpod-morrisville-demo-v2";
const AUTH_EVENT = "pingpod-demo-auth";
const BOARDS_EVENT = "pingpod-demo-boards";
const MINUTE = 60_000;
const DAY = 86_400_000;
const hasWindow = typeof window !== "undefined";

const DEFAULT_SETTINGS: Settings = {
  venue_name: "PingPod Morrisville",
  public_app_url: "https://pingpod-morrisville-rewards.vercel.app",
  pilot_start: null,
  pilot_end: null,
  max_session_minutes: 180,
  checkin_reminder_minutes: 90,
  manual_min_minutes: 5,
  manual_max_minutes: 180,
  backdate_days: 7,
  daily_minutes_cap: 300,
  crew_min_size: 2,
  crew_max_size: 8,
  auto_approve_timer: false,
  default_board_scope: "verified",
  display_scope: "verified",
  display_rotation_seconds: 15,
  display_slides: ["minutes", "streaks", "crews", "highlights"],
  boards_enabled: ["minutes", "streaks", "longest", "spindex", "crews"],
  rewards_enabled: false,
};
const settings = (): Settings => ({
  ...DEFAULT_SETTINGS,
  display_slides: [...DEFAULT_SETTINGS.display_slides],
  boards_enabled: [...DEFAULT_SETTINGS.boards_enabled],
});

const BLOCKED_TERMS = [
  "fuck", "shit", "bitch", "cunt", "pussy", "nigger", "nigga", "faggot",
  "retard", "whore", "slut", "porn", "nazi", "hitler", "pingpodstaff",
];
const AVATARS: AvatarColor[] = ["pink", "white", "blue", "green", "orange", "purple"];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ── Stored state ───────────────────────────────────────────────────────
interface StoredCrew {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string | null;
  archived_at: string | null;
  created_at: string;
}
interface StoredMembership {
  crew_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  left_reason: string | null;
}
interface Stored {
  v: 2;
  account: { id: string; email: string; pw: string } | null;
  signedIn: boolean;
  profile: Profile | null;
  sessions: PlaySession[];
  crews: StoredCrew[];
  memberships: StoredMembership[];
  spindex: SpindexClaim | null;
  requests: SupportRequest[];
  rate: { action: string; at: number }[];
}

const fresh = (): Stored => ({
  v: 2,
  account: null,
  signedIn: false,
  profile: null,
  sessions: [],
  crews: [],
  memberships: [],
  spindex: null,
  requests: [],
  rate: [],
});

let memory: Stored | null = null;

function load(): Stored {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored;
        if (parsed && parsed.v === 2) return { ...fresh(), ...parsed };
      }
    }
  } catch {
    /* storage blocked (private mode, previews) — fall back to memory */
  }
  return memory ? structuredClone(memory) : fresh();
}

function save(s: Stored) {
  memory = structuredClone(s);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* memory copy is enough for this tab */
  }
  emit(BOARDS_EVENT);
}

function emit(name: string, detail?: unknown) {
  if (!hasWindow) return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* ignore */
  }
}

/** Test helper: wipe demo data (also used by "delete account"). */
export function resetDemo() {
  memory = null;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Small helpers ──────────────────────────────────────────────────────
const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const iso = (ms: number) => new Date(ms).toISOString();
const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
};
const hasBlockedTerm = (v: string) => {
  const letters = v.toLowerCase().replace(/[^a-z]/g, "");
  return BLOCKED_TERMS.some((t) => letters.includes(t));
};
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[Math.floor(Math.random() * 32)]).join("");
const normalizeCode = (code: string) => (code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const hashPw = (pw: string) => {
  // Not security: demo accounts live only in this browser.
  let h = 5381;
  for (const ch of pw) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return `demo-${(h >>> 0).toString(36)}`;
};
const delay = () => new Promise<void>((r) => setTimeout(r, hasWindow ? 90 : 0));
const fail = (message: string): never => {
  throw new Error(message);
};

/** Offset (minutes) of America/New_York from UTC at an instant, e.g. -300 for EST. */
function venueOffset(utcMs: number): number {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, timeZoneName: "shortOffset" })
        .formatToParts(new Date(utcMs))
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return -300;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return -300;
  }
}

/** UTC ms for a wall-clock hour on a Morrisville calendar day. */
function venueLocalToUtc(day: string, hour: number): number {
  const guess = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const first = guess - venueOffset(guess) * MINUTE;
  return guess - venueOffset(first) * MINUTE;
}

function rateLimit(s: Stored, action: string, max: number, windowMs: number) {
  const now = Date.now();
  s.rate = s.rate.filter((r) => now - r.at < 3 * DAY);
  if (s.rate.filter((r) => r.action === action && now - r.at < windowMs).length >= max) {
    fail("You've done that a lot recently. Try again later.");
  }
  s.rate.push({ action, at: now });
}

function requireUser(s: Stored) {
  if (!s.signedIn || !s.account) fail("Please sign in first.");
  return s.account!;
}
function requireProfile(s: Stored) {
  requireUser(s);
  if (!s.profile) fail("Choose a nickname first.");
  return s.profile!;
}

/** Abandoned timers stop at the maximum and are flagged, like the nightly job does. */
function closeStale(s: Stored) {
  const max = DEFAULT_SETTINGS.max_session_minutes;
  const now = Date.now();
  for (const x of s.sessions) {
    if (x.status === "active" && now - Date.parse(x.started_at) > max * MINUTE) {
      x.status = "pending";
      x.ended_at = iso(Date.parse(x.started_at) + max * MINUTE);
      x.minutes = max;
      x.submitted_minutes = max;
      x.auto_closed = true;
      x.flags = [...x.flags, "auto_closed"];
      x.updated_at = iso(now);
    }
  }
}

// ── Sample competitors (always labeled) ────────────────────────────────
interface SamplePlayer {
  id: string;
  name: string;
  color: AvatarColor;
  weekly: number[]; // minutes this week, last week, … (most recent first)
  perWeek: number;
  spindex?: { rating: number; verified: boolean };
}
const SAMPLE_PLAYERS: SamplePlayer[] = [
  { id: "sample-riley", name: "Sample · Riley", color: "blue", weekly: [210, 180, 150, 200, 120, 90], perWeek: 3, spindex: { rating: 1640, verified: true } },
  { id: "sample-jordan", name: "Sample · Jordan", color: "green", weekly: [165, 120, 0, 140, 95, 0], perWeek: 2, spindex: { rating: 1480, verified: false } },
  { id: "sample-casey", name: "Sample · Casey", color: "orange", weekly: [140, 150, 130, 90, 0, 0], perWeek: 2 },
  { id: "sample-sam", name: "Sample · Sam", color: "purple", weekly: [120, 0, 60, 45, 60, 75], perWeek: 2, spindex: { rating: 1320, verified: true } },
  { id: "sample-alex", name: "Sample · Alex", color: "white", weekly: [95, 110, 85, 0, 0, 0], perWeek: 2 },
  { id: "sample-morgan", name: "Sample · Morgan", color: "pink", weekly: [75, 60, 90, 60, 45, 30], perWeek: 1, spindex: { rating: 1210, verified: false } },
  { id: "sample-taylor", name: "Sample · Taylor", color: "blue", weekly: [45, 0, 0, 0, 0, 0], perWeek: 1 },
];
const SAMPLE_CREWS = [
  { id: "sample-crew-1", name: "Sample · Spin Doctors", invite_code: "DEMO2027", members: ["sample-riley", "sample-jordan", "sample-casey"] },
  { id: "sample-crew-2", name: "Sample · Net Gains", invite_code: "NETGAINS", members: ["sample-sam", "sample-alex"] },
  { id: "sample-crew-3", name: "Sample · Topspin Club", invite_code: "TOPSPIN8", members: ["sample-morgan", "sample-taylor"] },
];
const SAMPLE_JOINED = () => iso(Date.now() - 120 * DAY);

let sampleCache: { day: string; sessions: Map<string, PlaySession[]> } | null = null;

/** Deterministic approved sessions for each sample player, regenerated once per day. */
function sampleSessions(): Map<string, PlaySession[]> {
  const today = venueDate();
  if (sampleCache?.day === today) return sampleCache.sessions;
  const thisWeek = weekStart(today);
  const todayIndex = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${thisWeek}T12:00:00Z`)) / DAY);
  const map = new Map<string, PlaySession[]>();
  for (const p of SAMPLE_PLAYERS) {
    const list: PlaySession[] = [];
    p.weekly.forEach((minutes, w) => {
      if (minutes <= 0) return;
      const ws = addDays(thisWeek, -7 * w);
      const available = w === 0 ? todayIndex + 1 : 7;
      const n = Math.max(1, Math.min(p.perWeek, available));
      let left = minutes;
      for (let k = 0; k < n; k++) {
        const part = k === n - 1 ? left : Math.round(minutes / n / 5) * 5 || 5;
        left -= part;
        const dayIndex = Math.min(available - 1, Math.floor(((k + 1) * available) / (n + 1)));
        const day = addDays(ws, dayIndex);
        const start = venueLocalToUtc(day, 11 + ((k * 3 + w) % 8));
        list.push({
          id: `${p.id}-${w}-${k}`,
          user_id: p.id,
          method: k % 2 === 0 ? "timer" : "manual",
          status: "approved",
          started_at: iso(start),
          ended_at: iso(start + part * MINUTE),
          played_on: day,
          minutes: part,
          submitted_minutes: part,
          note: null,
          client_request_id: null,
          last_checkin_at: null,
          auto_closed: false,
          flags: [],
          reviewed_at: iso(start + part * MINUTE),
          review_reason: null,
          created_at: iso(start + part * MINUTE),
          updated_at: iso(start + part * MINUTE),
        });
      }
    });
    map.set(p.id, list);
  }
  sampleCache = { day: today, sessions: map };
  return map;
}

// ── Board math (mirrors private.board / private.crew_board) ────────────
interface BoardPlayer {
  id: string;
  name: string;
  color: AvatarColor;
  public: boolean;
  showSpindex: boolean;
  sessions: PlaySession[];
  spindex: { rating: number; status: "verified" | "unverified"; at: string } | null;
  createdAt: string | null;
}

function players(s: Stored): BoardPlayer[] {
  const samples = sampleSessions();
  const list: BoardPlayer[] = SAMPLE_PLAYERS.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    public: true,
    showSpindex: true,
    sessions: samples.get(p.id) ?? [],
    spindex: p.spindex
      ? { rating: p.spindex.rating, status: p.spindex.verified ? "verified" : "unverified", at: iso(Date.now() - 30 * DAY) }
      : null,
    createdAt: null,
  }));
  if (s.account && s.profile) {
    list.push({
      id: s.account.id,
      name: s.profile.display_name,
      color: s.profile.avatar_color,
      public: s.profile.show_on_leaderboard && !s.profile.hidden_by_admin,
      showSpindex: s.profile.show_spindex,
      sessions: s.sessions,
      spindex: s.spindex ? { rating: s.spindex.rating, status: s.spindex.status, at: s.spindex.verified_at ?? s.spindex.created_at } : null,
      createdAt: s.profile.created_at,
    });
  }
  return list;
}

const statuses = (scope: Scope) => (scope === "community" ? ["approved", "pending"] : ["approved"]);

function periodStart(period: Period | "all"): string {
  const today = venueDate();
  if (period === "week") return weekStart(today);
  if (period === "month") return `${today.slice(0, 8)}01`;
  if (period === "all") return "2000-01-01";
  return fail("Unknown period.");
}

const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
const cmpTime = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : Date.parse(a) - Date.parse(b);

function streakInfo(days: string[], today = venueDate()) {
  const weeks = [...new Set(days.map(weekStart))].sort();
  const runs: { len: number; last: string }[] = [];
  let run = 0;
  let prev: string | null = null;
  let thirdWeek: string | null = null;
  for (const w of weeks) {
    if (prev && addDays(prev, 7) === w) run += 1;
    else {
      if (prev) runs.push({ len: run, last: prev });
      run = 1;
    }
    if (run === 3 && !thirdWeek) thirdWeek = w;
    prev = w;
  }
  if (prev) runs.push({ len: run, last: prev });
  const lastWeek = addDays(weekStart(today), -7);
  return {
    cur: Math.max(0, ...runs.filter((r) => r.last >= lastWeek).map((r) => r.len)),
    longest: Math.max(0, ...runs.map((r) => r.len)),
    weeks: weeks.length,
    thirdWeek,
  };
}

type Ranked = Omit<LeaderRow, "is_me">;

function board(s: Stored, metric: Metric, period: Period, scope: Scope): Ranked[] {
  if (scope !== "verified" && scope !== "community") fail("Unknown scope.");
  const st = statuses(scope);
  const start = periodStart(period);
  const eligible = players(s).filter((p) => p.public);
  type Row = Ranked & { tie: (string | null)[]; extra: number[] };
  let rows: Row[] = [];
  if (metric === "minutes") {
    for (const p of eligible) {
      const q = p.sessions.filter((x) => st.includes(x.status) && x.played_on >= start);
      const v = q.reduce((a, x) => a + x.minutes, 0);
      if (v <= 0) continue;
      const last = q.map((x) => x.ended_at).sort(cmpTime).at(-1) ?? null;
      rows.push({ rank: 0, user_id: p.id, display_name: p.name, avatar_color: p.color, value: v, secondary: null, sessions: q.length, detail: null, tie: [last], extra: [] });
    }
    rows.sort((a, b) => b.value - a.value || cmpTime(a.tie[0], b.tie[0]) || byName(a.display_name, b.display_name) || a.user_id.localeCompare(b.user_id));
  } else if (metric === "longest") {
    for (const p of eligible) {
      const q = p.sessions.filter((x) => st.includes(x.status) && x.played_on >= start);
      if (!q.length) continue;
      const best = [...q].sort((a, b) => b.minutes - a.minutes || cmpTime(a.ended_at, b.ended_at))[0];
      if (best.minutes <= 0) continue;
      rows.push({ rank: 0, user_id: p.id, display_name: p.name, avatar_color: p.color, value: best.minutes, secondary: null, sessions: q.length, detail: best.played_on, tie: [best.ended_at], extra: [] });
    }
    rows.sort((a, b) => b.value - a.value || cmpTime(a.tie[0], b.tie[0]) || byName(a.display_name, b.display_name) || a.user_id.localeCompare(b.user_id));
  } else if (metric === "streaks") {
    for (const p of eligible) {
      const q = p.sessions.filter((x) => st.includes(x.status));
      const info = streakInfo(q.map((x) => x.played_on));
      if (info.cur <= 0) continue;
      const mins = q.reduce((a, x) => a + x.minutes, 0);
      rows.push({ rank: 0, user_id: p.id, display_name: p.name, avatar_color: p.color, value: info.cur, secondary: info.longest, sessions: info.weeks, detail: null, tie: [], extra: [mins] });
    }
    rows.sort((a, b) => b.value - a.value || (b.secondary ?? 0) - (a.secondary ?? 0) || b.extra[0] - a.extra[0] || byName(a.display_name, b.display_name) || a.user_id.localeCompare(b.user_id));
  } else if (metric === "spindex") {
    for (const p of eligible) {
      if (!p.spindex || !p.showSpindex) continue;
      if (scope === "verified" && p.spindex.status !== "verified") continue;
      rows.push({
        rank: 0, user_id: p.id, display_name: p.name, avatar_color: p.color, value: p.spindex.rating, secondary: null, sessions: null,
        detail: p.spindex.status === "verified" ? "verified" : "self_reported", tie: [p.spindex.at], extra: [p.spindex.status === "verified" ? 1 : 0],
      });
    }
    rows.sort((a, b) => b.value - a.value || b.extra[0] - a.extra[0] || cmpTime(a.tie[0], b.tie[0]) || byName(a.display_name, b.display_name) || a.user_id.localeCompare(b.user_id));
  } else {
    fail("Unknown leaderboard.");
  }
  rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  return rows.map(({ tie: _tie, extra: _extra, ...r }) => r);
}

// Crews: sample crews + crews the demo user created.
interface CrewRecord {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string | null;
  archived_at: string | null;
  created_at: string;
  sample: boolean;
}
interface MembershipRecord {
  crew_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
}

function crewRecords(s: Stored): CrewRecord[] {
  const joined = SAMPLE_JOINED();
  return [
    ...SAMPLE_CREWS.map((c) => ({ id: c.id, name: c.name, invite_code: c.invite_code, owner_id: c.members[0], archived_at: null, created_at: joined, sample: true })),
    ...s.crews.map((c) => ({ ...c, sample: false })),
  ];
}

function memberships(s: Stored): MembershipRecord[] {
  const joined = SAMPLE_JOINED();
  return [
    ...SAMPLE_CREWS.flatMap((c) => c.members.map((m) => ({ crew_id: c.id, user_id: m, joined_at: joined, left_at: null }))),
    ...s.memberships.map((m) => ({ crew_id: m.crew_id, user_id: m.user_id, joined_at: m.joined_at, left_at: m.left_at })),
  ];
}

const inMembership = (ended: string | null, joined: string, left: string | null) =>
  ended !== null && Date.parse(ended) > Date.parse(joined) && (left === null || Date.parse(ended) <= Date.parse(left));

function activeCrew(s: Stored): CrewRecord | null {
  if (!s.account) return null;
  const m = s.memberships.find((x) => x.user_id === s.account!.id && x.left_at === null);
  if (!m) return null;
  return crewRecords(s).find((c) => c.id === m.crew_id && c.archived_at === null) ?? null;
}

function sessionsOf(s: Stored, userId: string): PlaySession[] {
  if (s.account && userId === s.account.id) return s.sessions;
  return sampleSessions().get(userId) ?? [];
}

function crewContributions(s: Stored, crewId: string, scope: Scope, period: Period) {
  const st = statuses(scope);
  const start = periodStart(period);
  const out: PlaySession[] = [];
  for (const m of memberships(s).filter((x) => x.crew_id === crewId)) {
    for (const x of sessionsOf(s, m.user_id)) {
      if (st.includes(x.status) && x.played_on >= start && inMembership(x.ended_at, m.joined_at, m.left_at)) out.push(x);
    }
  }
  return out;
}

type CrewRanked = Omit<CrewRow, "is_mine">;

function crewBoard(s: Stored, period: Period, scope: Scope): CrewRanked[] {
  const minSize = DEFAULT_SETTINGS.crew_min_size;
  const all = memberships(s);
  const rows: (CrewRanked & { last: string | null })[] = [];
  for (const c of crewRecords(s)) {
    if (c.archived_at) continue;
    const members = all.filter((m) => m.crew_id === c.id && m.left_at === null).length;
    if (members < minSize) continue;
    const contrib = crewContributions(s, c.id, scope, period);
    const minutes = contrib.reduce((a, x) => a + x.minutes, 0);
    const last = contrib.map((x) => x.ended_at).sort(cmpTime).at(-1) ?? null;
    rows.push({
      rank: 0,
      crew_id: c.id,
      name: c.name,
      minutes,
      members,
      contributors: new Set(contrib.map((x) => x.user_id)).size,
      avg_minutes: Math.floor(minutes / members),
      last,
    });
  }
  rows.sort((a, b) => b.minutes - a.minutes || cmpTime(a.last, b.last) || byName(a.name, b.name) || a.crew_id.localeCompare(b.crew_id));
  return rows.map(({ last: _last, ...r }, i) => ({ ...r, rank: i + 1 }));
}

// ── Stats + achievements ───────────────────────────────────────────────
function userStats(s: Stored): Stats {
  const uid = s.account!.id;
  const q = s.sessions.filter((x) => x.status === "approved" || x.status === "pending");
  const today = venueDate();
  const wk = weekStart(today);
  const mo = `${today.slice(0, 8)}01`;
  const sum = (f: (x: PlaySession) => boolean) => q.filter(f).reduce((a, x) => a + x.minutes, 0);
  const streak = streakInfo(q.map((x) => x.played_on));
  const vBoard = board(s, "minutes", "week", "verified");
  const cBoard = board(s, "minutes", "week", "community");
  return {
    week_verified: sum((x) => x.status === "approved" && x.played_on >= wk),
    week_pending: sum((x) => x.status === "pending" && x.played_on >= wk),
    month_verified: sum((x) => x.status === "approved" && x.played_on >= mo),
    month_pending: sum((x) => x.status === "pending" && x.played_on >= mo),
    total_verified: sum((x) => x.status === "approved"),
    total_pending: sum((x) => x.status === "pending"),
    sessions: q.length,
    pending_sessions: q.filter((x) => x.status === "pending").length,
    longest_session: Math.max(0, ...q.map((x) => x.minutes)),
    current_streak: streak.cur,
    longest_streak: streak.longest,
    rank_week_verified: vBoard.find((r) => r.user_id === uid)?.rank ?? null,
    rank_week_community: cBoard.find((r) => r.user_id === uid)?.rank ?? null,
    ranked_week_verified: vBoard.length,
    ranked_week_community: cBoard.length,
  };
}

function venueDayStartIso(day: string) {
  return iso(venueLocalToUtc(day, 0));
}

function achievementsFor(s: Stored): Achievement[] {
  const uid = s.account!.id;
  const q = s.sessions
    .filter((x) => x.status === "approved" || x.status === "pending")
    .sort((a, b) => cmpTime(a.ended_at, b.ended_at) || a.id.localeCompare(b.id));
  const total = q.reduce((a, x) => a + x.minutes, 0);
  let cum = 0;
  const reached: Record<number, string | null> = { 60: null, 300: null, 600: null, 1200: null };
  for (const x of q) {
    cum += x.minutes;
    for (const t of [60, 300, 600, 1200]) if (cum >= t && !reached[t]) reached[t] = x.ended_at;
  }
  const longest = Math.max(0, ...q.map((x) => x.minutes));
  const longAt = q.find((x) => x.minutes >= 120)?.ended_at ?? null;
  const streak = streakInfo(q.map((x) => x.played_on));
  const crewAt = s.memberships.filter((m) => m.user_id === uid).map((m) => m.joined_at).sort(cmpTime)[0] ?? null;
  const verified = q.filter((x) => x.status === "approved").map((x) => x.reviewed_at ?? x.ended_at).sort(cmpTime)[0] ?? null;

  // Weekly top five: completed weeks, verified minutes, everyone not hidden by staff.
  const thisWeek = weekStart(venueDate());
  const weekly = new Map<string, Map<string, number>>();
  for (const p of players(s)) {
    for (const x of p.sessions) {
      if (x.status !== "approved") continue;
      const w = weekStart(x.played_on);
      if (w >= thisWeek) continue;
      const m = weekly.get(w) ?? new Map<string, number>();
      m.set(p.id, (m.get(p.id) ?? 0) + x.minutes);
      weekly.set(w, m);
    }
  }
  let top5Week: string | null = null;
  for (const w of [...weekly.keys()].sort()) {
    const totals = weekly.get(w)!;
    const mine = totals.get(uid);
    if (mine === undefined) continue;
    const better = [...totals.values()].filter((v) => v > mine).length;
    if (better + 1 <= 5) {
      top5Week = w;
      break;
    }
  }

  const row = (code: string, title: string, description: string, target: number, progress: number, earned_at: string | null): Achievement => ({
    code, title, description, target, progress, earned_at,
  });
  return [
    row("first_session", "First session", "Finish your first playing session.", 1, Math.min(q.length, 1), q[0]?.ended_at ?? null),
    row("first_hour", "First hour", "Play 60 minutes in total.", 60, Math.min(total, 60), reached[60]),
    row("minutes_300", "300 club", "Reach 300 total minutes.", 300, Math.min(total, 300), reached[300]),
    row("minutes_600", "600 club", "Reach 600 total minutes.", 600, Math.min(total, 600), reached[600]),
    row("minutes_1200", "Twenty hours", "Reach 1,200 total minutes.", 1200, Math.min(total, 1200), reached[1200]),
    row("long_session", "Long rally", "Play one session of 2 hours or more.", 120, Math.min(longest, 120), longAt),
    row("streak_3", "Three-week streak", "Play at least once in three weeks in a row.", 3, Math.min(streak.longest, 3),
      streak.thirdWeek ? venueDayStartIso(streak.thirdWeek) : null),
    row("crew_joined", "Crew up", "Create or join a crew.", 1, crewAt ? 1 : 0, crewAt),
    row("first_verified", "Verified", "Have a session approved by PingPod staff.", 1, verified ? 1 : 0, verified),
    row("weekly_top5", "Top five", "Finish a week in the top five for verified minutes.", 1, top5Week ? 1 : 0,
      top5Week ? venueDayStartIso(addDays(top5Week, 7)) : null),
  ];
}

// ── Validation shared by several methods ───────────────────────────────
function validNickname(v: string | null): string {
  if (!v || !/^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,19}$/.test(v)) {
    fail("Nicknames are 2–20 characters: letters, numbers, spaces, _ . or -");
  }
  if (hasBlockedTerm(v!)) fail("Please choose a different nickname.");
  return v!;
}

function validCrewName(raw: string): string {
  const v = clean(raw);
  if (!v || v.length < 3 || v.length > 24 || !/^[A-Za-z0-9][A-Za-z0-9 _.'&!\-]*$/.test(v)) {
    fail("Crew names are 3–24 characters: letters, numbers, spaces and - _ . ' & !");
  }
  if (hasBlockedTerm(v!)) fail("Please choose a different crew name.");
  return v!;
}

function requireCrewOwner(s: Stored): StoredCrew {
  const c = activeCrew(s);
  const own = c && !c.sample ? s.crews.find((x) => x.id === c.id) : undefined;
  if (!own || own.owner_id !== s.account!.id) fail("Only the crew owner can do that.");
  return own!;
}

function leaveCrewFor(s: Stored, reason: string) {
  const uid = s.account!.id;
  const m = s.memberships.find((x) => x.user_id === uid && x.left_at === null);
  if (!m) return;
  m.left_at = iso(Date.now());
  m.left_reason = reason;
  const own = s.crews.find((c) => c.id === m.crew_id);
  if (own && (own.owner_id === uid || own.owner_id === null)) {
    // Only the demo user can belong to a crew they created, so leaving empties it.
    own.archived_at = iso(Date.now());
  }
}

function newSession(uid: string, fields: Partial<PlaySession>): PlaySession {
  const now = iso(Date.now());
  return {
    id: uuid(),
    user_id: uid,
    method: "timer",
    status: "active",
    started_at: now,
    ended_at: null,
    played_on: venueDate(),
    minutes: 0,
    submitted_minutes: null,
    note: null,
    client_request_id: null,
    last_checkin_at: null,
    auto_closed: false,
    flags: [],
    reviewed_at: null,
    review_reason: null,
    created_at: now,
    updated_at: now,
    ...fields,
  };
}

// ── The demo API ───────────────────────────────────────────────────────
const STAFF_ONLY = "Staff tools need the live database. Demo mode has no staff accounts.";
const adminReject = async (): Promise<never> => {
  throw new Error(STAFF_ONLY);
};
const demoAdmin: AdminApi = {
  claim: adminReject,
  sessions: adminReject,
  reviewSession: adminReject,
  bulkApprove: adminReject,
  players: adminReject,
  moderatePlayer: adminReject,
  deletePlayer: adminReject,
  crews: adminReject,
  moderateCrew: adminReject,
  spindex: adminReject,
  reviewSpindex: adminReject,
  requests: adminReject,
  resolveRequest: adminReject,
  updateSettings: adminReject,
  rewards: adminReject,
  saveReward: adminReject,
  staff: adminReject,
  setStaff: adminReject,
  analytics: adminReject,
  exportRows: adminReject,
  audit: adminReject,
};

const authUser = (s: Stored): AuthUser | null => (s.signedIn && s.account ? { id: s.account.id, email: s.account.email } : null);
const emitAuth = (event: AuthEvent, user: AuthUser | null) => emit(AUTH_EVENT, { event, user });

export const demoApi: Api = {
  mode: "demo",

  async getUser() {
    return authUser(load());
  },
  onAuthChange(cb) {
    if (!hasWindow) return () => {};
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ event: AuthEvent; user: AuthUser | null }>).detail;
      cb(d?.event ?? "OTHER", d?.user ?? null);
    };
    window.addEventListener(AUTH_EVENT, handler);
    return () => window.removeEventListener(AUTH_EVENT, handler);
  },
  async signUp(email, password) {
    await delay();
    const e = (email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail("That email address doesn't look right.");
    if ((password ?? "").length < 6) fail("Use at least 6 characters for your password.");
    let s = load();
    if (s.account && s.account.email === e) fail("There's already an account with that email. Sign in instead.");
    // One demo account per browser: a different email starts a fresh demo.
    if (s.account) s = fresh();
    s.account = { id: `demo-${uuid()}`, email: e, pw: hashPw(password) };
    s.signedIn = true;
    save(s);
    emitAuth("SIGNED_IN", authUser(s));
    return { needsConfirmation: false };
  },
  async signIn(email, password) {
    await delay();
    const s = load();
    const e = (email ?? "").trim().toLowerCase();
    if (!s.account || s.account.email !== e || s.account.pw !== hashPw(password ?? "")) {
      fail("That email and password don't match. Try again, or reset your password.");
    }
    s.signedIn = true;
    save(s);
    emitAuth("SIGNED_IN", authUser(s));
  },
  async signOut() {
    const s = load();
    s.signedIn = false;
    save(s);
    emitAuth("SIGNED_OUT", null);
  },
  async sendPasswordReset() {
    await delay();
  },
  async updatePassword(password) {
    await delay();
    const s = load();
    requireUser(s);
    if ((password ?? "").length < 6) fail("Use at least 6 characters for your password.");
    s.account!.pw = hashPw(password);
    save(s);
  },

  async getMe(): Promise<Me> {
    await delay();
    const s = load();
    requireUser(s);
    closeStale(s);
    save(s);
    if (!s.profile) return { server_now: iso(Date.now()), profile: null, settings: settings() };
    const crew = activeCrew(s);
    return {
      server_now: iso(Date.now()),
      profile: { ...s.profile },
      admin_role: null,
      active_session: s.sessions.find((x) => x.status === "active") ?? null,
      crew: crew ? { id: crew.id, name: crew.name, invite_code: crew.invite_code, is_owner: crew.owner_id === s.account!.id } : null,
      spindex: s.spindex,
      stats: userStats(s),
      settings: settings(),
    };
  },
  async saveProfile(input: ProfileInput) {
    await delay();
    const s = load();
    const acct = requireUser(s);
    const name = validNickname(clean(input.display_name));
    if (SAMPLE_PLAYERS.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail("That nickname is taken. Try another.");
    if (s.profile && s.profile.display_name !== name) rateLimit(s, "rename", 5, DAY);
    const now = iso(Date.now());
    s.profile = {
      id: acct.id,
      display_name: name,
      avatar_color: AVATARS.includes(input.avatar_color) ? input.avatar_color : "pink",
      show_on_leaderboard: input.show_on_leaderboard ?? true,
      show_spindex: input.show_spindex ?? true,
      hidden_by_admin: false,
      created_at: s.profile?.created_at ?? now,
      updated_at: now,
    };
    save(s);
    return { ...s.profile };
  },

  async startSession(clientRequestId) {
    await delay();
    const s = load();
    const profile = requireProfile(s);
    closeStale(s);
    if (clientRequestId) {
      const same = s.sessions.find((x) => x.client_request_id === clientRequestId);
      if (same) return same;
    }
    if (s.sessions.some((x) => x.status === "active")) fail("You already have a session running.");
    rateLimit(s, "start", 12, 60 * MINUTE);
    const row = newSession(profile.id, { client_request_id: clientRequestId || null });
    s.sessions.unshift(row);
    save(s);
    return row;
  },
  async checkinSession(id) {
    await delay();
    const s = load();
    requireUser(s);
    const row = s.sessions.find((x) => x.id === id && x.status === "active");
    if (!row) fail("That session already ended.");
    row!.last_checkin_at = iso(Date.now());
    row!.updated_at = row!.last_checkin_at;
    save(s);
    return row!;
  },
  async stopSession(id, endedAt) {
    await delay();
    const s = load();
    requireUser(s);
    const row = s.sessions.find((x) => x.id === id);
    if (!row) fail("Session not found.");
    if (row!.status !== "active") return row!;
    const cfg = DEFAULT_SETTINGS;
    const now = Date.now();
    const started = Date.parse(row!.started_at);
    let end = Math.min(now, endedAt ? Date.parse(endedAt) : now);
    end = Math.max(end, now - 30 * MINUTE, started);
    end = Math.min(end, started + cfg.max_session_minutes * MINUTE);
    const minutes = Math.floor((end - started) / MINUTE);
    row!.ended_at = iso(end);
    row!.submitted_minutes = minutes;
    row!.updated_at = iso(now);
    if (minutes < cfg.manual_min_minutes) {
      row!.status = "cancelled";
      row!.minutes = 0;
      row!.flags = [...row!.flags, "too_short"];
    } else {
      row!.status = "pending";
      row!.minutes = minutes;
      if (minutes >= cfg.max_session_minutes) row!.flags = [...row!.flags, "hit_max"];
    }
    save(s);
    return row!;
  },
  async cancelSession(id) {
    await delay();
    const s = load();
    requireUser(s);
    const row = s.sessions.find((x) => x.id === id);
    if (!row) fail("Session not found.");
    if (row!.status === "cancelled") return row!;
    if (row!.status !== "active") fail("That session already ended.");
    row!.status = "cancelled";
    row!.ended_at = iso(Date.now());
    row!.minutes = 0;
    row!.updated_at = row!.ended_at;
    save(s);
    return row!;
  },
  async logSession(input: LogInput) {
    await delay();
    const s = load();
    const profile = requireProfile(s);
    const cfg = DEFAULT_SETTINGS;
    const today = venueDate();
    if (input.client_request_id) {
      const same = s.sessions.find((x) => x.client_request_id === input.client_request_id);
      if (same) return same;
    }
    const m = Number(input.minutes);
    if (!Number.isFinite(m) || !Number.isInteger(m) || m < cfg.manual_min_minutes || m > cfg.manual_max_minutes) {
      fail(`Enter between ${cfg.manual_min_minutes} and ${cfg.manual_max_minutes} minutes.`);
    }
    const day = input.played_on;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) fail("That date is in the future.");
    if (day < addDays(today, -cfg.backdate_days)) {
      fail(`You can log play from the last ${cfg.backdate_days} days. Ask staff for anything older.`);
    }
    const note = clean(input.note);
    if (note && note.length > 280) fail("Keep notes under 280 characters.");
    if (s.sessions.some((x) => x.status === "active")) fail("Finish your running session first.");
    const counted = s.sessions.filter((x) => x.played_on === day && (x.status === "pending" || x.status === "approved"));
    if (counted.some((x) => x.method === "manual" && x.minutes === m)) fail(`You already logged ${m} minutes on that day.`);
    if (counted.reduce((a, x) => a + x.minutes, 0) + m > cfg.daily_minutes_cap) {
      fail(`That would be more than ${cfg.daily_minutes_cap} minutes in one day. Ask staff if that's right.`);
    }
    const flags = counted.some((x) => x.method === "timer") ? ["same_day_as_timer"] : [];
    rateLimit(s, "manual_log", 6, 60 * MINUTE);
    const start = day === today ? Math.max(venueLocalToUtc(day, 0), Date.now() - m * MINUTE) : venueLocalToUtc(day, 12);
    const row = newSession(profile.id, {
      method: "manual",
      status: "pending",
      started_at: iso(start),
      ended_at: iso(start + m * MINUTE),
      played_on: day,
      minutes: m,
      submitted_minutes: m,
      note,
      client_request_id: input.client_request_id || null,
      flags,
    });
    s.sessions.unshift(row);
    save(s);
    return row;
  },
  async mySessions(limit = 100) {
    await delay();
    const s = load();
    requireUser(s);
    return s.sessions
      .filter((x) => x.status !== "active")
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
      .slice(0, limit);
  },
  async myRequests() {
    await delay();
    const s = load();
    requireUser(s);
    return [...s.requests].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  },
  async submitRequest(kind, message, sessionId) {
    await delay();
    const s = load();
    requireUser(s);
    if (!["correction", "privacy", "deletion", "other"].includes(kind)) fail("Unknown request type.");
    const msg = clean(message);
    if (!msg || msg.length > 600) fail("Write a short message (up to 600 characters).");
    if (sessionId && !s.sessions.some((x) => x.id === sessionId)) fail("Session not found.");
    rateLimit(s, "request", 5, DAY);
    s.requests.unshift({
      id: uuid(),
      kind,
      session_id: sessionId ?? null,
      message: msg!,
      status: "open",
      admin_response: null,
      resolved_at: null,
      created_at: iso(Date.now()),
    });
    save(s);
  },
  async achievements() {
    await delay();
    const s = load();
    requireUser(s);
    return achievementsFor(s);
  },
  async submitSpindex(rating, note) {
    await delay();
    const s = load();
    requireProfile(s);
    if (!Number.isInteger(rating) || rating < 0 || rating > 3000) fail("SPINDEX ratings run from 0 to 3000.");
    const n = clean(note);
    if (n && n.length > 200) fail("Keep the note under 200 characters.");
    rateLimit(s, "spindex", 5, DAY);
    // Demo mode has no staff, so a demo rating is always self-reported.
    s.spindex = { id: uuid(), rating, status: "unverified", source: "self_reported", verified_at: null, created_at: iso(Date.now()) };
    save(s);
  },
  async removeSpindex() {
    await delay();
    const s = load();
    requireUser(s);
    s.spindex = null;
    save(s);
  },
  async deleteAccount() {
    await delay();
    const s = load();
    requireUser(s);
    resetDemo();
    save(fresh());
    emitAuth("SIGNED_OUT", null);
  },

  async myCrew(period, scope): Promise<MyCrew | null> {
    await delay();
    const s = load();
    const uid = requireUser(s).id;
    const crew = activeCrew(s);
    if (!crew) return null;
    if (scope !== "verified" && scope !== "community") fail("Unknown period or scope.");
    const st = statuses(scope);
    const start = periodStart(period);
    const active = memberships(s).filter((m) => m.crew_id === crew.id && m.left_at === null);
    const sampleById = new Map(SAMPLE_PLAYERS.map((p) => [p.id, p]));
    const members: CrewMember[] = active
      .map((m) => {
        const sp = sampleById.get(m.user_id);
        const name = sp ? sp.name : (s.profile?.display_name ?? "You");
        const color = sp ? sp.color : (s.profile?.avatar_color ?? "pink");
        const minutes = sessionsOf(s, m.user_id)
          .filter((x) => st.includes(x.status) && x.played_on >= start && inMembership(x.ended_at, m.joined_at, m.left_at))
          .reduce((a, x) => a + x.minutes, 0);
        return { user_id: m.user_id, display_name: name, avatar_color: color, is_owner: m.user_id === crew.owner_id, is_me: m.user_id === uid, joined_at: m.joined_at, minutes };
      })
      .sort((a, b) => cmpTime(a.joined_at, b.joined_at));
    const ranked = crewBoard(s, period, scope);
    return {
      id: crew.id,
      name: crew.name,
      invite_code: crew.invite_code,
      is_owner: crew.owner_id === uid,
      created_at: crew.created_at,
      hidden_by_admin: false,
      min_members: DEFAULT_SETTINGS.crew_min_size,
      max_members: DEFAULT_SETTINGS.crew_max_size,
      rank: ranked.find((r) => r.crew_id === crew.id)?.rank ?? null,
      crews_ranked: ranked.length,
      total_minutes: crewContributions(s, crew.id, scope, period).reduce((a, x) => a + x.minutes, 0),
      members,
    };
  },
  async previewCrew(code): Promise<CrewPreview | null> {
    await delay();
    const s = load();
    const c = crewRecords(s).find((x) => x.invite_code === normalizeCode(code) && x.archived_at === null);
    if (!c) return null;
    return {
      name: c.name,
      members: memberships(s).filter((m) => m.crew_id === c.id && m.left_at === null).length,
      max_members: DEFAULT_SETTINGS.crew_max_size,
    };
  },
  async createCrew(name) {
    await delay();
    const s = load();
    const uid = requireProfile(s).id;
    const v = validCrewName(name);
    if (activeCrew(s)) fail("Leave your current crew first.");
    if (crewRecords(s).some((c) => c.archived_at === null && c.name.toLowerCase() === v.toLowerCase())) fail("That crew name is taken.");
    rateLimit(s, "create_crew", 3, DAY);
    const now = iso(Date.now());
    const crew: StoredCrew = { id: `demo-crew-${uuid()}`, name: v, invite_code: newCode(), owner_id: uid, archived_at: null, created_at: now };
    s.crews.push(crew);
    s.memberships.push({ crew_id: crew.id, user_id: uid, joined_at: now, left_at: null, left_reason: null });
    save(s);
  },
  async joinCrew(code) {
    await delay();
    const s = load();
    const uid = requireProfile(s).id;
    const c = crewRecords(s).find((x) => x.invite_code === normalizeCode(code) && x.archived_at === null);
    if (!c) fail("That invite code didn't work. Check it and try again.");
    const current = activeCrew(s);
    if (current?.id === c!.id) return;
    if (current) fail("You're already in a crew. Leave it first to join another.");
    if (memberships(s).filter((m) => m.crew_id === c!.id && m.left_at === null).length >= DEFAULT_SETTINGS.crew_max_size) {
      fail("That crew is full.");
    }
    rateLimit(s, "join_crew", 6, DAY);
    s.memberships.push({ crew_id: c!.id, user_id: uid, joined_at: iso(Date.now()), left_at: null, left_reason: null });
    save(s);
  },
  async leaveCrew() {
    await delay();
    const s = load();
    requireUser(s);
    if (!activeCrew(s)) fail("You're not in a crew.");
    leaveCrewFor(s, "left");
    save(s);
  },
  async renameCrew(name) {
    await delay();
    const s = load();
    requireUser(s);
    const own = requireCrewOwner(s);
    const v = validCrewName(name);
    if (crewRecords(s).some((c) => c.archived_at === null && c.id !== own.id && c.name.toLowerCase() === v.toLowerCase())) {
      fail("That crew name is taken.");
    }
    rateLimit(s, "rename_crew", 5, DAY);
    own.name = v;
    save(s);
  },
  async regenerateCrewCode() {
    await delay();
    const s = load();
    requireUser(s);
    requireCrewOwner(s).invite_code = newCode();
    save(s);
  },
  async transferCrew(userId) {
    await delay();
    const s = load();
    requireUser(s);
    const own = requireCrewOwner(s);
    if (!memberships(s).some((m) => m.crew_id === own.id && m.user_id === userId && m.left_at === null)) {
      fail("That player isn't in your crew.");
    }
    own.owner_id = userId;
    save(s);
  },
  async removeCrewMember(userId) {
    await delay();
    const s = load();
    const uid = requireUser(s).id;
    const own = requireCrewOwner(s);
    if (userId === uid) fail("Use Leave crew instead.");
    const m = s.memberships.find((x) => x.crew_id === own.id && x.user_id === userId && x.left_at === null);
    if (!m) fail("That player isn't in your crew.");
    m!.left_at = iso(Date.now());
    m!.left_reason = "removed_by_owner";
    save(s);
  },

  async leaderboard(metric, period, scope, limit = 50) {
    await delay();
    const s = load();
    const uid = authUser(s)?.id;
    const cap = Math.min(Math.max(limit || 50, 1), 200);
    return board(s, metric, period, scope)
      .filter((r) => r.rank <= cap || r.user_id === uid)
      .map((r) => ({ ...r, is_me: r.user_id === uid }));
  },
  async crewLeaderboard(period, scope, limit = 50) {
    await delay();
    const s = load();
    const mine = authUser(s) ? activeCrew(s)?.id : undefined;
    const cap = Math.min(Math.max(limit || 50, 1), 200);
    return crewBoard(s, period, scope)
      .filter((r) => r.rank <= cap || r.crew_id === mine)
      .map((r) => ({ ...r, is_mine: r.crew_id === mine }));
  },
  async displayData(): Promise<DisplayData> {
    await delay();
    const s = load();
    const cfg = settings();
    const scope = cfg.display_scope;
    const st = statuses(scope);
    const wk = weekStart(venueDate());
    const minutes = board(s, "minutes", "week", scope);
    const longest = board(s, "longest", "week", scope);
    const crews = crewBoard(s, "week", scope);
    const weekSessions = players(s).flatMap((p) => p.sessions.filter((x) => st.includes(x.status) && x.played_on >= wk));
    const mostSessions = [...minutes].sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0) || a.rank - b.rank)[0];
    const weekStartIso = venueDayStartIso(wk);
    return {
      generated_at: iso(Date.now()),
      scope,
      rotation_seconds: cfg.display_rotation_seconds,
      slides: cfg.display_slides,
      public_app_url: hasWindow ? window.location.origin : cfg.public_app_url,
      venue_name: cfg.venue_name,
      week_start: wk,
      minutes: minutes.slice(0, 8).map((r) => ({ rank: r.rank, display_name: r.display_name, avatar_color: r.avatar_color, value: r.value, sessions: r.sessions ?? 0 })),
      longest: longest.slice(0, 8).map((r) => ({ rank: r.rank, display_name: r.display_name, avatar_color: r.avatar_color, value: r.value, detail: r.detail ?? undefined })),
      streaks: board(s, "streaks", "all", scope)
        .slice(0, 8)
        .map((r) => ({ rank: r.rank, display_name: r.display_name, avatar_color: r.avatar_color, value: r.value, secondary: r.secondary ?? 0 })),
      crews: crews
        .filter((c) => c.minutes > 0)
        .slice(0, 6)
        .map((c) => ({ rank: c.rank, name: c.name, minutes: c.minutes, members: c.members, avg_minutes: c.avg_minutes })),
      highlights: {
        players: new Set(weekSessions.map((x) => x.user_id)).size,
        minutes: weekSessions.reduce((a, x) => a + x.minutes, 0),
        sessions: weekSessions.length,
        new_players: s.profile && Date.parse(s.profile.created_at) >= Date.parse(weekStartIso) ? 1 : 0,
        longest: longest[0] ? { display_name: longest[0].display_name, minutes: longest[0].value } : null,
        most_sessions: mostSessions ? { display_name: mostSessions.display_name, sessions: mostSessions.sessions ?? 0 } : null,
        top_crew: crews[0] && crews[0].minutes > 0 ? { name: crews[0].name, minutes: crews[0].minutes } : null,
        active_crews: crews.filter((c) => c.minutes > 0).length,
      },
    };
  },
  async publicSettings() {
    return settings();
  },
  async rewards() {
    return [];
  },
  subscribeBoards(onChange) {
    if (!hasWindow) return () => {};
    const handler = () => onChange();
    window.addEventListener(BOARDS_EVENT, handler);
    // Other tabs of this browser: localStorage writes fire `storage`.
    const storage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) onChange();
    };
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(BOARDS_EVENT, handler);
      window.removeEventListener("storage", storage);
    };
  },

  admin: demoAdmin,
};
