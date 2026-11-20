import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, ChevronRight, Hand, Pencil, Play, Square, Timer } from "lucide-react";
import { api, errorText, toAppError } from "../lib/api";
import { Link } from "../lib/router";
import { KEYS, newRequestId, store, type PendingStop } from "../lib/storage";
import { elapsedMs, formatClock, formatDuration, formatTime, relativeDay } from "../lib/time";
import type { PlaySession, Reward } from "../lib/types";
import { useApp } from "../state";
import { Button, ConfirmSheet, InlineError, Sheet, StatusChip, useToast } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { SurveyFooter, SurveyPopup } from "../components/SurveyCard";
import SpindexSheet from "../components/SpindexSheet";
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
            {error && <InlineError>{error}</InlineError>}
          </section>
          <div className="stack-sm">
            <StatStrip />
            <SpindexRow />
          </div>
          <RecentSessions version={version} />
          <VerifyEmailCard />
          <SurveyFooter />
          <SurveyPopup />
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
  const counted = session.status === "pending" || session.status === "approved";
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

function StatStrip() {
  const { me } = useApp();
  const s = me.stats!;
  const profile = me.profile!;
  const weekTotal = s.week_verified + s.week_pending;
  const rank = me.settings.default_board_scope === "verified" ? s.rank_week_verified : s.rank_week_community;
  const hidden = !profile.show_on_leaderboard || profile.hidden_by_admin;
  return (
    <section className="stat-strip" aria-label="Your week">
      <Link to="/me" className="stat-cell">
        <span className="stat-label">This week</span>
        <span className="stat-value num">
          <CountUp value={weekTotal} />
          <small>min</small>
        </span>
      </Link>
      <Link to="/rankings" className="stat-cell">
        <span className="stat-label">Rank</span>
        {hidden ? (
          <span className="stat-value text">Hidden</span>
        ) : (
          <span className={`stat-value num ${rank ? "pink" : ""}`}>{rank ? `#${rank}` : "—"}</span>
        )}
      </Link>
      <Link to="/me" className="stat-cell">
        <span className="stat-label">Streak</span>
        <span className="stat-value num">
          {s.current_streak}
          <small>{s.current_streak === 1 ? "day" : "days"}</small>
        </span>
      </Link>
      <Link to="/crew" className="stat-cell">
        <span className="stat-label">Crew</span>
        {me.crew ? (
          <span className="stat-value text">{me.crew.name}</span>
        ) : (
          <span className="stat-value text pink">Join one</span>
        )}
      </Link>
    </section>
  );
}

/** One slim row under the stats: add your SPINDEX, or see and update it. */
function SpindexRow() {
  const { me } = useApp();
  const [open, setOpen] = useState(false);
  const claim = me.spindex ?? null;
  return (
    <>
      <button type="button" className={`panel spindex-prompt ${claim ? "has" : ""}`} onClick={() => setOpen(true)}>
        {claim ? (
          <span className="spindex-row-text">
            <span className="stat-label">SPINDEX</span>
            <strong className="num">
              {claim.rating}
              {claim.status === "verified" && <BadgeCheck size={16} className="verified-tick" aria-label="Verified" />}
            </strong>
          </span>
        ) : (
          <span>
            <strong>Add your SPINDEX</strong>
          </span>
        )}
        <span className="spindex-row-cta">
          {claim ? "Update" : ""}
          <ChevronRight size={18} aria-hidden />
        </span>
      </button>
      {open && <SpindexSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function RecentSessions({ version }: { version: number }) {
  const [rows, setRows] = useState<PlaySession[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    void api
      .mySessions(8)
      .then((all) => setRows(all.filter((s) => s.status !== "cancelled").slice(0, 3)))
      .catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load, version]);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Recent sessions</h2>
        <Link to="/me" className="link-btn" style={{ display: "inline-flex", alignItems: "center" }}>
          History <ChevronRight size={16} />
        </Link>
      </div>
      {error ? (
        <InlineError onRetry={load}>{error}</InlineError>
      ) : !rows ? (
        <LogoLoader label="Loading sessions" />
      ) : rows.length === 0 ? (
        <div className="list empty-row">No sessions yet.</div>
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
