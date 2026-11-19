import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Clock3, Hand, Pencil, Play, Square, Timer } from "lucide-react";
import { api, errorText, toAppError } from "../lib/api";
import { Link } from "../lib/router";
import { KEYS, newRequestId, store, type PendingStop } from "../lib/storage";
import { elapsedMs, formatClock, formatDuration, formatNumber, formatTime, relativeDay } from "../lib/time";
import type { Achievement, PlaySession, Reward } from "../lib/types";
import { useApp } from "../state";
import { Button, ConfirmSheet, InlineError, ProgressBar, Sheet, Skeleton, StatusChip, useToast } from "../components/ui";
import LogPlaySheet from "./LogPlaySheet";

export default function Home() {
  const { me, serverNow, refresh, finished, setFinished, bump, version } = useApp();
  const toast = useToast();
  const profile = me.profile!;
  const settings = me.settings;
  const active = me.active_session ?? null;

  const [now, setNow] = useState(serverNow);
  const [busy, setBusy] = useState<"" | "start" | "stop" | "checkin">("");
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
      for (let attempt = 0; ; attempt++) {
        try {
          await api.startSession(requestId); // same id on retry → never two sessions
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
      <section className="greeting" aria-live="polite">
        <div className="eyebrow">Hey, {profile.display_name}</div>
        <h1>{active ? (waitingToSync ? "Finishing up" : "You're playing") : "Ready to play?"}</h1>
      </section>

      {!active ? (
        <section className="play-card">
          <Button variant="primary" size="xl" block loading={busy === "start"} onClick={() => void start()} icon={<Play size={24} fill="currentColor" />}>
            Start playing
          </Button>
          <Button variant="secondary" size="lg" block onClick={() => setLogOpen(true)} icon={<Pencil size={18} />}>
            Log past play
          </Button>
          {error && <InlineError>{error}</InlineError>}
        </section>
      ) : (
        <section className="play-card is-active" aria-label="Session in progress">
          <div className="live-label">
            <span className="live-dot" aria-hidden />
            {waitingToSync ? "Waiting for connection" : "Playing now"}
          </div>
          <div className="timer num" role="timer" aria-label={`${elapsedMin} minutes played`}>
            {formatClock(elapsed)}
          </div>
          <div className="timer-meta">
            <span>
              <Clock3 size={16} style={{ color: "var(--muted)" }} aria-hidden /> Started {formatTime(active.started_at)}
            </span>
            <span>
              <CheckCircle2 size={16} aria-hidden /> Saved to your account
            </span>
          </div>
          <p className="small-print">You can lock your phone or close this page — the timer keeps running on our side.</p>

          {needsCheckin && !waitingToSync && (
            <div className="checkin" role="alert">
              <strong>Still playing?</strong>
              <span className="small-print" style={{ color: "var(--text-2)" }}>
                It's been {formatDuration(elapsedMin)}. Timers stop automatically at {formatDuration(settings.max_session_minutes)}.
              </span>
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
          {nearMax && !needsCheckin && (
            <p className="small-print">Heads up: timers stop at {formatDuration(settings.max_session_minutes)}.</p>
          )}

          {waitingToSync ? (
            <InlineError onRetry={() => void refresh().catch(() => {})}>
              Your finish time is saved on this phone. It'll submit as soon as you're online.
            </InlineError>
          ) : (
            <>
              <Button variant="primary" size="xl" block loading={busy === "stop"} onClick={() => void finish()} icon={<Square size={20} fill="currentColor" />}>
                Finish session
              </Button>
              <Button variant="ghost" onClick={() => setDiscardOpen(true)} disabled={busy !== ""}>
                Discard this session
              </Button>
            </>
          )}
          {error && <InlineError>{error}</InlineError>}
        </section>
      )}

      <StatsTiles />
      <NextMilestone version={version} />
      <RecentSessions version={version} />
      <RewardsStrip enabled={settings.rewards_enabled} />

      <footer className="app-foot">
        <span>Morrisville Rewards · Beta</span>
        <span>A local PingPod Morrisville pilot — not the official PingPod app or booking.</span>
      </footer>

      {logOpen && (
        <LogPlaySheet
          settings={settings}
          onClose={() => setLogOpen(false)}
          onSaved={() => {
            setLogOpen(false);
            toast("Session submitted · Pending verification");
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
  const counted = session.status === "pending" || session.status === "approved";
  return (
    <Sheet title={counted ? "Nice session." : "Session not counted"} onClose={onClose}>
      <div className="result">
        {counted ? (
          <>
            <div className="result-min num">
              {session.minutes}
              <small>min</small>
            </div>
            <p>You played {formatDuration(session.minutes)}. Session submitted.</p>
            <StatusChip status={session.status} />
            {session.status === "pending" && (
              <p className="small-print">
                Staff verify sessions before they count on the verified leaderboard. You'll see it in Community right away.
              </p>
            )}
            {session.flags.includes("hit_max") && (
              <p className="small-print">This timer reached the {session.minutes}-minute limit, so staff will take a look.</p>
            )}
          </>
        ) : (
          <p>That was under 5 minutes, so it wasn't saved. Start a new session when you're ready.</p>
        )}
      </div>
      <Button variant="primary" size="lg" block onClick={onClose}>
        Done
      </Button>
    </Sheet>
  );
}

function StatsTiles() {
  const { me } = useApp();
  const s = me.stats!;
  const profile = me.profile!;
  const weekTotal = s.week_verified + s.week_pending;
  const rank = s.rank_week_verified ?? s.rank_week_community;
  const rankScope = s.rank_week_verified ? "verified" : "community";
  return (
    <section className="stats-grid" aria-label="Your week">
      <Link to="/me" className="stat">
        <span className="stat-label">This week</span>
        <span className="stat-value num">
          {formatNumber(weekTotal)}
          <small>min</small>
        </span>
        <span className="stat-sub">
          {s.week_pending > 0 ? `${formatNumber(s.week_pending)} pending` : weekTotal > 0 ? "All verified" : "Start a session"}
        </span>
      </Link>
      <Link to="/rankings" className="stat">
        <span className="stat-label">Your rank</span>
        {!profile.show_on_leaderboard || profile.hidden_by_admin ? (
          <>
            <span className="stat-value text">Hidden</span>
            <span className="stat-sub">Off public boards</span>
          </>
        ) : rank ? (
          <>
            <span className="stat-value num">#{rank}</span>
            <span className="stat-sub pink">You're #{rank} this week · {rankScope}</span>
          </>
        ) : (
          <>
            <span className="stat-value num">—</span>
            <span className="stat-sub">Play to get ranked</span>
          </>
        )}
      </Link>
      <Link to="/me" className="stat">
        <span className="stat-label">Weekly streak</span>
        <span className="stat-value num">
          {s.current_streak}
          <small>{s.current_streak === 1 ? "wk" : "wks"}</small>
        </span>
        <span className="stat-sub">{s.current_streak ? `Best ${s.longest_streak}` : "Play this week to start one"}</span>
      </Link>
      <Link to="/crew" className="stat">
        <span className="stat-label">Your crew</span>
        {me.crew ? (
          <>
            <span className="stat-value text">{me.crew.name}</span>
            <span className="stat-sub">See standings</span>
          </>
        ) : (
          <>
            <span className="stat-value text">No crew</span>
            <span className="stat-sub pink">Join a crew</span>
          </>
        )}
      </Link>
    </section>
  );
}

function NextMilestone({ version }: { version: number }) {
  const [items, setItems] = useState<Achievement[] | null>(null);
  useEffect(() => {
    void api
      .achievements()
      .then(setItems)
      .catch(() => setItems([]));
  }, [version]);
  if (!items || !items.length) return null;
  const next = items
    .filter((a) => !a.earned_at)
    .sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
  const earned = items.filter((a) => a.earned_at).length;
  if (!next)
    return (
      <section className="panel milestone">
        <strong>All {items.length} milestones earned. Legend.</strong>
      </section>
    );
  return (
    <Link to="/me" className="panel milestone" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="milestone-top">
        <div>
          <div className="eyebrow">Next milestone</div>
          <strong>{next.title}</strong>
        </div>
        <span>
          {earned}/{items.length} earned
        </span>
      </div>
      <ProgressBar value={next.progress} max={next.target} label={next.title} />
      <span className="small-print">
        {next.description} {next.target > 1 && `· ${formatNumber(next.progress)}/${formatNumber(next.target)}`}
      </span>
    </Link>
  );
}

function RecentSessions({ version }: { version: number }) {
  const [rows, setRows] = useState<PlaySession[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    void api
      .mySessions(3)
      .then(setRows)
      .catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load, version]);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Recent play</h2>
        <Link to="/me" className="link-btn" style={{ display: "inline-flex", alignItems: "center" }}>
          History <ChevronRight size={16} />
        </Link>
      </div>
      {error ? (
        <InlineError onRetry={load}>{error}</InlineError>
      ) : !rows ? (
        <Skeleton count={2} height={64} />
      ) : rows.length === 0 ? (
        <div className="panel small-print">No sessions yet. Tap Start playing when you get on a table.</div>
      ) : (
        <div className="list">
          {rows.map((s) => (
            <SessionRow key={s.id} s={s} />
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
          {s.method === "timer" ? "Timer" : "Self-reported"} · <StatusChip status={s.status} short />
        </span>
      </span>
      <span className="session-min num">
        {s.minutes}
        <small>min</small>
      </span>
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
            {r.criteria && <span className="small-print">How to earn: {r.criteria}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
