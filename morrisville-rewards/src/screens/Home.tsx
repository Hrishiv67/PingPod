import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Hand, MapPin, Pencil, Play, Square, Timer } from "lucide-react";
import { api, errorText, toAppError } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { KEYS, newRequestId, store, type PendingStop } from "../lib/storage";
import { addDays, elapsedMs, formatClock, formatDuration, formatNumber, formatTime, relativeDay, venueDate, weekStart } from "../lib/time";
import { atVenue, currentFix, LocationError, milesAway, needsLocation } from "../lib/geo";
import type { PlaySession, Reward } from "../lib/types";
import { useApp } from "../state";
import { Button, ConfirmSheet, InlineError, Sheet, StatusChip, useToast } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { SurveyFooter } from "../components/SurveyCard";
import SpindexCard from "../components/SpindexCard";
import { WeeklyRally } from "../components/rally/WeeklyRally";
import { PingPodMark } from "../components/Logo";
import VerifyEmailCard from "../components/VerifyEmailCard";
import LogPlaySheet from "./LogPlaySheet";
import CountUp from "../components/CountUp";

export default function Home() {
  const { me, serverNow, refresh, finished, setFinished, bump, version } = useApp();
  const toast = useToast();
  const profile = me.profile!;
  const settings = me.settings;
  const active = me.active_session ?? null;

  const [now, setNow] = useState(serverNow);
  const [busy, setBusy] = useState<"" | "start" | "stop" | "checkin">("");
  const [locating, setLocating] = useState(false);
  const [sessions, setSessions] = useState<PlaySession[] | null>(null);
  const [sessionsError, setSessionsError] = useState("");
  const loadSessions = useCallback(() => {
    setSessionsError("");
    void api
      .mySessions(60)
      .then((all) => setSessions(all.filter((s) => s.status !== "cancelled")))
      .catch((err) => setSessionsError(errorText(err)));
  }, []);
  useEffect(loadSessions, [loadSessions, version]);
  const [error, setError] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [queued, setQueued] = useState<PendingStop | null>(() => store.get<PendingStop>(KEYS.pendingStop));

  useEffect(() => {
    if (!active) return;
    setNow(serverNow());
    const id = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(id);
  }, [active, serverNow]);

  useEffect(() => {
    if (queued && (!active || active.id !== queued.id)) setQueued(store.get<PendingStop>(KEYS.pendingStop));
  }, [active, queued]);

  async function start() {
    setBusy("start");
    setError("");
    const requestId = newRequestId();
    try {
      // Timer location check (when staff have switched it on): the phone's position is only compared
      // with PingPod's, never saved.
      let fix = null;
      if (needsLocation(settings)) {
        setLocating(true);
        try {
          fix = await currentFix();
        } catch (err) {
          const kind = err instanceof LocationError ? err.kind : "unavailable";
          throw new Error(
            kind === "denied"
              ? `Allow location for this site to start the timer. It only checks that you're at ${settings.venue_name}.`
              : `Couldn't find your location. Check that Location Services are on and try again.`,
          );
        } finally {
          setLocating(false);
        }
        if (!atVenue(settings, fix))
          throw new Error(`You're about ${milesAway(settings, fix)} from ${settings.venue_name}. The timer starts when you're there.`);
      }
      for (let attempt = 0; ; attempt++) {
        try {
          await api.startSession(requestId, fix); // same id on retry → never two sessions
          break;
        } catch (err) {
          const e = toAppError(err);
          if (!e.offline || attempt >= 2) throw e;
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      await refresh();
      bump();
    } catch (err) {
      setError(errorText(err));
      if (/already have a session/i.test(errorText(err))) await refresh().catch(() => {});
    } finally {
      setBusy("");
    }
  }

  async function finish() {
    if (!active) return;
    const endedAt = new Date(serverNow()).toISOString();
    setBusy("stop");
    setError("");
    try {
      const result = await api.stopSession(active.id, endedAt);
      setFinished(result);
      await refresh();
      bump();
    } catch (err) {
      const e = toAppError(err);
      if (e.offline) {
        const pending = { id: active.id, endedAt };
        store.set(KEYS.pendingStop, pending);
        setQueued(pending);
        toast("Saved on this phone. We'll submit it when you're back online.");
      } else setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function checkin() {
    if (!active) return;
    setBusy("checkin");
    try {
      await api.checkinSession(active.id);
      await refresh();
      toast("Got it — your timer is still running.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  const elapsed = active ? elapsedMs(active.started_at, now) : 0;
  const elapsedMin = Math.floor(elapsed / 60000);
  const reminderMs = settings.checkin_reminder_minutes * 60000;
  const lastTouch = active ? new Date(active.last_checkin_at ?? active.started_at).getTime() : 0;
  const needsCheckin = Boolean(active) && elapsed >= reminderMs && now - lastTouch >= reminderMs;
  const nearMax = active && elapsedMin >= settings.max_session_minutes - 15;
  const waitingToSync = Boolean(queued && active && queued.id === active.id);

  return (
    <div className="page">
      {!active ? (
        <>
          <section className="greeting" aria-live="polite">
            <div className="eyebrow">Hey, {profile.display_name}</div>
            <h1>Ready to play?</h1>
          </section>
          <section className="play-card">
            <Button variant="primary" size="xl" block loading={busy === "start"} onClick={() => void start()} icon={<Play size={24} fill="currentColor" />}>
              Start playing
            </Button>
            <Button variant="secondary" size="lg" block onClick={() => setLogOpen(true)} icon={<Pencil size={18} />}>
              Log past session
            </Button>
            {locating && (
              <p className="locating">
                <MapPin size={16} aria-hidden /> Checking you're at {settings.venue_name}…
              </p>
            )}
            {error && <InlineError>{error}</InlineError>}
          </section>
          <Rally sessions={sessions} />
          <SpindexCard />
          <RecentSessions rows={sessions} error={sessionsError} onRetry={loadSessions} />
          <VerifyEmailCard />
          <SurveyFooter />
          <RewardsStrip enabled={settings.rewards_enabled} />
        </>
      ) : (
        <section className="session-focus" aria-label="Session in progress" aria-live="polite">
          <div className="live-label">
            <span className="live-dot" aria-hidden />
            {waitingToSync ? "Waiting for connection" : "Playing now"}
          </div>
          <div className="timer num" role="timer" aria-label={`${elapsedMin} minutes played`}>
            {formatClock(elapsed)}
          </div>
          <p className="timer-meta">
            Started {formatTime(active.started_at)} · Keeps running if you lock your phone
          </p>

          {needsCheckin && !waitingToSync && (
            <div className="checkin" role="alert">
              <strong>Still playing?</strong>
              <span>Timers stop on their own at {formatDuration(settings.max_session_minutes)}.</span>
              <div className="row-2">
                <Button variant="secondary" loading={busy === "checkin"} onClick={() => void checkin()} icon={<Hand size={18} />}>
                  Still playing
                </Button>
                <Button variant="light" onClick={() => void finish()} disabled={busy !== ""}>
                  Finish now
                </Button>
              </div>
            </div>
          )}
          {nearMax && !needsCheckin && <p className="timer-note">Timers stop at {formatDuration(settings.max_session_minutes)}.</p>}
          {elapsedMin < 5 && <p className="timer-note">Sessions count once they reach 5 minutes.</p>}

          <div className="session-actions">
            {waitingToSync ? (
              <InlineError onRetry={() => void refresh().catch(() => {})}>
                Finish time saved on this phone. It'll submit when you're back online.
              </InlineError>
            ) : (
              <>
                <Button variant="primary" size="xl" block loading={busy === "stop"} onClick={() => void finish()} icon={<Square size={20} fill="currentColor" />}>
                  Finish session
                </Button>
                <button type="button" className="link-btn discard-btn" onClick={() => setDiscardOpen(true)} disabled={busy !== ""}>
                  Discard session
                </button>
              </>
            )}
            {error && <InlineError>{error}</InlineError>}
          </div>
        </section>
      )}

      {logOpen && (
        <LogPlaySheet
          settings={settings}
          onClose={() => setLogOpen(false)}
          onSaved={() => {
            setLogOpen(false);
            toast("Session saved. Nice work!");
            bump();
            void refresh().catch(() => {});
          }}
        />
      )}
      {discardOpen && active && (
        <ConfirmSheet
          title="Discard session?"
          body={<p>This timer won't count toward your minutes. This can't be undone.</p>}
          confirmLabel="Discard session"
          danger
          onClose={() => setDiscardOpen(false)}
          onConfirm={async () => {
            await api.cancelSession(active.id);
            await refresh();
            toast("Session discarded.");
          }}
        />
      )}
      {finished && <FinishedSheet session={finished} onClose={() => setFinished(null)} />}
    </div>
  );
}

function FinishedSheet({ session, onClose }: { session: PlaySession; onClose: () => void }) {
  const { me } = useApp();
  const counted = session.status === "pending" || session.status === "approved";
  const stats = me.stats;
  const rank = stats ? (me.settings.default_board_scope === "verified" ? stats.rank_week_verified : stats.rank_week_community) : null;
  const onBoard = me.profile?.show_on_leaderboard && !me.profile?.hidden_by_admin;
  return (
    <Sheet title={counted ? "Nice session." : "Not saved"} onClose={onClose}>
      <div className="result">
        {counted ? (
          <>
            <div className="result-min num">
              <CountUp value={session.minutes} duration={800} />
              <small>min</small>
            </div>
            <p>Saved to your leaderboard.</p>
            {stats && (
              <div className="result-stats">
                {onBoard && rank ? (
                  <span>
                    <strong className="num">#{rank}</strong> this week
                  </span>
                ) : null}
                <span>
                  <strong className="num">{formatNumber(stats.week_verified + stats.week_pending)}</strong> min this week
                </span>
                {stats.current_streak > 0 && (
                  <span>
                    <strong className="num">{stats.current_streak}</strong>-day streak
                  </span>
                )}
              </div>
            )}
            {session.flags.includes("hit_max") && (
              <p className="result-note">Timer hit the {session.minutes}-minute limit. Played less? Fix it from your history.</p>
            )}
          </>
        ) : (
          <p>Sessions under 5 minutes aren't saved.</p>
        )}
      </div>
      <Button variant="primary" size="lg" block onClick={onClose}>
        Done
      </Button>
    </Sheet>
  );
}

/** This week on the Weekly Rally card: flames for counted play days, minutes, rank, streak, goal. */
function Rally({ sessions }: { sessions: PlaySession[] | null }) {
  const { me, refresh, bump } = useApp();
  const toast = useToast();
  const stats = me.stats!;
  const profile = me.profile!;
  const today = venueDate();
  const monday = weekStart(today);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const playedDays = useMemo(() => {
    const counted = new Set(
      (sessions ?? []).filter((s) => s.status === "approved" || s.status === "pending").map((s) => s.played_on),
    );
    return days.map((d) => counted.has(d));
  }, [sessions, days]);
  const hidden = !profile.show_on_leaderboard || profile.hidden_by_admin;
  const rank = hidden ? null : me.settings.default_board_scope === "verified" ? stats.rank_week_verified : stats.rank_week_community;
  const goals =
    profile.weekly_goal_days && profile.weekly_goal_minutes
      ? { days: profile.weekly_goal_days, hours: profile.weekly_goal_minutes / 60 }
      : {};
  return (
    <WeeklyRally
      activity={{ playedDays: sessions ? playedDays : undefined, tableMinutes: stats.week_verified + stats.week_pending }}
      goals={goals}
      today={days.indexOf(today)}
      rank={rank}
      streak={stats.current_streak}
      mark={<PingPodMark height={12} />}
      onSave={async (g) => {
        await api.saveWeeklyGoals(g ? g.days : null, g ? Math.round(g.hours * 60) : null);
        await refresh();
        bump();
        if (!g) toast("Weekly goal removed.");
      }}
    />
  );
}

function RecentSessions({ rows, error, onRetry }: { rows: PlaySession[] | null; error: string; onRetry: () => void }) {
  const recent = rows?.slice(0, 3) ?? null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Recent sessions</h2>
        <Link to="/me#history" className="link-btn" style={{ display: "inline-flex", alignItems: "center" }}>
          History <ChevronRight size={16} />
        </Link>
      </div>
      {error ? (
        <InlineError onRetry={onRetry}>{error}</InlineError>
      ) : !recent ? (
        <LogoLoader label="Loading sessions" />
      ) : recent.length === 0 ? (
        <div className="list empty-row">No sessions yet.</div>
      ) : (
        <div className="list">
          {recent.map((s) => (
            <SessionRow key={s.id} s={s} onClick={() => navigate(`/me#session-${s.id}`)} />
          ))}
        </div>
      )}
    </section>
  );
}

export function SessionRow({ s, onClick }: { s: PlaySession; onClick?: () => void }) {
  const inner = (
    <>
      <span className="session-icon">{s.method === "timer" ? <Timer size={20} /> : <Pencil size={18} />}</span>
      <span className="session-main">
        <strong>{relativeDay(s.played_on)}</strong>
        <span>
          {s.method === "timer" ? "Timer" : "Logged"}
          {s.status !== "approved" && (
            <>
              {" · "}
              <StatusChip status={s.status} short />
            </>
          )}
        </span>
      </span>
      <span className="session-min num">
        {s.minutes}
        <small>min</small>
      </span>
      {onClick && <ChevronRight size={18} className="session-chevron" aria-hidden />}
    </>
  );
  return onClick ? (
    <button type="button" className="session-row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="session-row">{inner}</div>
  );
}

function RewardsStrip({ enabled }: { enabled: boolean }) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  useEffect(() => {
    if (!enabled) return;
    void api
      .rewards()
      .then(setRewards)
      .catch(() => setRewards([]));
  }, [enabled]);
  if (!enabled || !rewards.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Rewards</h2>
      </div>
      <div className="list">
        {rewards.map((r) => (
          <div key={r.id} className="request-row">
            <strong>{r.title}</strong>
            {r.description && <p>{r.description}</p>}
            {r.criteria && <span className="small-print">{r.criteria}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
