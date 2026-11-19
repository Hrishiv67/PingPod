export type Session = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  method: "timer" | "manual";
  status: "active" | "pending" | "approved" | "rejected";
};

export type Ranking = {
  id: string;
  display_name: string;
  minutes: number;
  sessions: number;
};
export type TeamRanking = {
  id: string;
  name: string;
  minutes: number;
  members: number;
};

const venueTime = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export function dayKey(date: Date): string {
  return venueTime(date);
}

function utcOfVenueDay(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function weeklyStreak(sessions: Session[], today = new Date()): number {
  const weeks = new Set(
    sessions
      .filter((s) => s.status !== "rejected" && s.status !== "active")
      .map((s) => {
        const key = dayKey(new Date(s.started_at));
        const d = utcOfVenueDay(key);
        const dow = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - dow);
        return d.toISOString().slice(0, 10);
      }),
  );
  const d = utcOfVenueDay(dayKey(today));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (!weeks.has(d.toISOString().slice(0, 10)))
    d.setUTCDate(d.getUTCDate() - 7);
  let count = 0;
  while (weeks.has(d.toISOString().slice(0, 10))) {
    count += 1;
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return count;
}

export function elapsedMinutes(start: string, now = Date.now()): number {
  return Math.min(
    180,
    Math.max(0, Math.floor((now - new Date(start).getTime()) / 60000)),
  );
}

export function totalMinutes(sessions: Session[]): number {
  return sessions
    .filter((s) => s.status === "pending" || s.status === "approved")
    .reduce((acc, session) => acc + session.minutes, 0);
}

export function thisWeekMinutes(
  sessions: Session[],
  today = new Date(),
): number {
  const d = utcOfVenueDay(dayKey(today));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const key = d.toISOString().slice(0, 10);
  return sessions
    .filter((s) => {
      const sessionDay = utcOfVenueDay(dayKey(new Date(s.started_at)));
      sessionDay.setUTCDate(
        sessionDay.getUTCDate() - ((sessionDay.getUTCDay() + 6) % 7),
      );
      return sessionDay.toISOString().slice(0, 10) === key;
    })
    .reduce(
      (acc, s) =>
        acc +
        (s.status === "active" || s.status === "rejected" ? 0 : s.minutes),
      0,
    );
}
