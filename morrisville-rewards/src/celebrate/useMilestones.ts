import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { store } from "../lib/storage";
import { venueDate, weekStart } from "../lib/time";
import type { Me } from "../lib/types";
import { earnedKeys, goalHit, pickCelebrations, type Milestone } from "./milestones";

/**
 * Milestone pop-ups for the signed-in player. Checks once at startup and again after every save
 * (anything that calls bump(): a finished timer, a logged session, joining a crew…). Failures are
 * ignored: a celebration never gets in the way of the app.
 */
export function useMilestones(userId: string, me: Me | null, version: number) {
  const [queue, setQueue] = useState<Milestone[]>([]);
  const meRef = useRef(me);
  meRef.current = me;
  const running = useRef(false);
  const rerun = useRef(false);
  const seenKey = `pingpod-celebrated-${userId}`;

  const check = useCallback(
    async (startup: boolean) => {
      if (running.current) {
        rerun.current = true;
        return;
      }
      running.current = true;
      try {
        const m = meRef.current;
        const profile = m?.profile;
        if (!m || !profile) return;
        const stats = m.stats;
        const hasGoal = Boolean(profile.weekly_goal_days && profile.weekly_goal_minutes);
        const [achievements, sessions] = await Promise.all([api.achievements(), hasGoal ? api.mySessions(60) : Promise.resolve(null)]);
        let goalWeek: string | null = null;
        if (sessions && stats) {
          const monday = weekStart(venueDate());
          const days = new Set(
            sessions.filter((s) => (s.status === "approved" || s.status === "pending") && s.played_on >= monday).map((s) => s.played_on),
          ).size;
          if (goalHit(stats.week_verified + stats.week_pending, days, profile.weekly_goal_days, profile.weekly_goal_minutes)) goalWeek = monday;
        }
        const earned = earnedKeys({ achievements, sessions: stats?.sessions ?? 0, goalWeek });
        const { show, seen } = pickCelebrations(earned, store.get<string[]>(seenKey), startup);
        store.set(seenKey, seen);
        if (show.length) setQueue((q) => [...q, ...show]);
      } catch {
        /* never block the app over a celebration */
      } finally {
        running.current = false;
        if (rerun.current) {
          rerun.current = false;
          void check(false);
        }
      }
    },
    [seenKey],
  );

  const hasProfile = Boolean(me?.profile);
  const lastVersion = useRef<number | null>(null);
  useEffect(() => {
    if (!hasProfile) return;
    const startup = lastVersion.current === null;
    if (lastVersion.current === version) return;
    lastVersion.current = version;
    void check(startup);
  }, [hasProfile, version, check]);

  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, next };
}
