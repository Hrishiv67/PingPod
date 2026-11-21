import type { CelebrationSpec } from "./Celebration";

// Which milestone celebrations a player has earned, and which ones to show now.
// Most come from the server's achievements ("a:<code>"); session counts ("s:<n>") come from the
// player's stats and the weekly goal ("g:<monday>") from this week's minutes and play days.
// Each one shows once per player on a phone (the keys already celebrated are kept there).

export interface Milestone extends CelebrationSpec {
  key: string;
  group: string;
}

export const MILESTONES: Milestone[] = [
  { key: "a:first_session", group: "Sessions", kind: "sessions", value: 1, title: "First session", subtitle: "You're on the board. Welcome to the rally." },
  { key: "s:10", group: "Sessions", kind: "sessions", value: 10, title: "10 sessions", subtitle: "Ten times at the table. That's a regular." },
  { key: "s:25", group: "Sessions", kind: "sessions", value: 25, title: "25 sessions", subtitle: "Twenty-five sessions in. The tables know you by now." },
  { key: "s:50", group: "Sessions", kind: "sessions", value: 50, title: "50 sessions", subtitle: "Fifty. That's PingPod royalty." },
  { key: "a:first_hour", group: "Time played", kind: "hours", value: 1, title: "First hour", subtitle: "Sixty minutes of table time, done." },
  { key: "a:minutes_300", group: "Time played", kind: "hours", value: 5, title: "5 hours", subtitle: "Five hours on the table. The 300 club." },
  { key: "a:minutes_600", group: "Time played", kind: "hours", value: 10, title: "10 hours", subtitle: "Double digits. Serious table time." },
  { key: "a:minutes_1200", group: "Time played", kind: "hours", value: 20, title: "20 hours", subtitle: "Twenty hours. You basically live here." },
  { key: "a:streak_3", group: "Streaks", kind: "streak", value: 3, title: "3-day streak", subtitle: "Three days in a row. Keep the fire going." },
  { key: "a:streak_7", group: "Streaks", kind: "streak", value: 7, title: "7-day streak", subtitle: "A full week, every single day." },
  { key: "goal", group: "Big moments", kind: "goal", title: "Weekly goal hit", subtitle: "You hit this week's goal. New week starts Monday." },
  { key: "a:crew_joined", group: "Big moments", kind: "crew", title: "Crew up", subtitle: "You're in a crew. Your minutes count together now." },
  { key: "a:weekly_top5", group: "Big moments", kind: "top5", title: "Top five", subtitle: "You finished the week in the top five." },
  { key: "a:long_session", group: "Big moments", kind: "long", title: "Long rally", subtitle: "One session, two whole hours. Legendary." },
];

/** When several land at once (say a first session that ran two hours), this is the running order. */
const ORDER = [
  "a:first_session", "s:10", "s:25", "s:50", "a:long_session",
  "a:first_hour", "a:minutes_300", "a:minutes_600", "a:minutes_1200",
  "a:streak_3", "a:streak_7", "goal", "a:crew_joined", "a:weekly_top5",
];
/** Never more than this many in a row. */
export const MAX_IN_A_ROW = 3;
const SESSION_STEPS = [10, 25, 50];

const byKey = new Map(MILESTONES.map((m) => [m.key, m]));
const baseKey = (k: string) => (k.startsWith("g:") ? "goal" : k);

export interface EarnedInput {
  achievements: { code: string; earned_at: string | null }[];
  /** Counted sessions so far. */
  sessions: number;
  /** Monday (YYYY-MM-DD) of this week when this week's goal is hit, else null. */
  goalWeek: string | null;
}

export function earnedKeys({ achievements, sessions, goalWeek }: EarnedInput): string[] {
  const keys = achievements.filter((a) => a.earned_at && byKey.has(`a:${a.code}`)).map((a) => `a:${a.code}`);
  for (const n of SESSION_STEPS) if (sessions >= n) keys.push(`s:${n}`);
  if (goalWeek) keys.push(`g:${goalWeek}`);
  return keys;
}

/** Same rule as the Weekly Rally card: both the minutes and the number of days. */
export function goalHit(weekMinutes: number, playDays: number, goalDays: number | null | undefined, goalMinutes: number | null | undefined) {
  return Boolean(goalDays && goalMinutes && weekMinutes >= goalMinutes && playDays >= goalDays);
}

/**
 * What to celebrate now. `seen` is null the first time on this phone: everything already earned is
 * recorded quietly, so existing players aren't flooded. At startup only a weekly top-five finish
 * (earned while away) shows; anything else new then was earned on another phone and is skipped.
 */
export function pickCelebrations(earned: string[], seen: string[] | null, startup: boolean): { show: Milestone[]; seen: string[] } {
  if (!seen) return { show: [], seen: [...new Set(earned)] };
  const fresh = [...new Set(earned)].filter((k) => !seen.includes(k));
  const show = fresh
    .filter((k) => !startup || k === "a:weekly_top5")
    .sort((a, b) => ORDER.indexOf(baseKey(a)) - ORDER.indexOf(baseKey(b)))
    .slice(0, MAX_IN_A_ROW)
    .map((k) => ({ ...byKey.get(baseKey(k))!, key: k }));
  return { show, seen: [...seen, ...fresh] };
}
