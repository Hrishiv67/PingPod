import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Flame,
  Home,
  LogOut,
  Medal,
  PauseCircle,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import QRCode from "qrcode";
import {
  createTeam,
  getAdminStatus,
  getBoards,
  getMyState,
  getPending,
  isConfigured,
  joinTeam,
  leaveTeam,
  logSession,
  reviewSession,
  saveProfile,
  startSession,
  stopSession,
  supabase,
  type PendingSession,
  type Profile,
  type Team,
} from "./lib/api";
import { demo } from "./lib/demo";
import {
  dayKey,
  thisWeekMinutes,
  totalMinutes,
  weeklyStreak,
  type Ranking,
  type Session,
  type TeamRanking,
} from "./lib/metrics";
import { LOGO_SRC } from "./logo";

type View = "home" | "rankings" | "teams" | "profile" | "admin";
type Period = "week" | "month" | "all";
type Boards = { players: Ranking[]; teams: TeamRanking[] };
type NavItem = { id: View; icon: LucideIcon; label: string };
const EMPTY_BOARDS: Boards = { players: [], teams: [] };
const DISPLAY_MODE =
  new URLSearchParams(location.search).has("display") ||
  location.pathname.endsWith("/display");

function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`logo ${light ? "logo-light" : ""}`}>
      <img src={LOGO_SRC} alt="" />
      <span>PINGPOD</span>
    </span>
  );
}

function Pill({
  children,
  pink = false,
}: {
  children: ReactNode;
  pink?: boolean;
}) {
  return <span className={`pill ${pink ? "pill-pink" : ""}`}>{children}</span>;
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function Welcome({ onExplore }: { onExplore: () => void }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (authError) throw authError;
      setMessage(
        "Check your inbox for a secure sign-in link. You can close this tab and return.",
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="welcome">
      <header className="welcome-header">
        <Logo />
        <Pill>MORRISVILLE · BETA</Pill>
      </header>
      <main className="welcome-main">
        <div className="welcome-copy">
          <div className="eyebrow light-eyebrow">
            <span className="eyebrow-line" /> PLAY MORE. EARN YOUR PLACE.
          </div>
          <h1>
            Every minute
            <br />
            <em>counts.</em>
          </h1>
          <p>
            Track your table tennis time, climb local leaderboards, and build a
            crew with your friends.
          </p>
          <div className="welcome-features">
            <span>
              <Clock3 size={17} /> Log your play
            </span>
            <span>
              <Trophy size={17} /> Climb the board
            </span>
            <span>
              <Users size={17} /> Compete together
            </span>
          </div>
        </div>
        <section className="auth-card">
          <div className="auth-heading">
            <Pill pink>THE MORRISVILLE CHALLENGE</Pill>
            <h2>Ready to get on the board?</h2>
            <p>No download. No complicated setup. Just play.</p>
          </div>
          {isConfigured ? (
            <form onSubmit={sendLink} className="stack-form">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                autoComplete="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button className="primary-btn" disabled={sending} type="submit">
                {sending ? "Sending link…" : "Continue with email"}{" "}
                <ArrowRight size={18} />
              </button>
              {message && (
                <div className="success-msg" role="status">
                  <CheckCircle2 size={17} />
                  {message}
                </div>
              )}
              {error && (
                <div className="error-msg" role="alert">
                  {error}
                </div>
              )}
              <div className="auth-footnote">
                New here? We’ll create your account automatically.
                <br />
                Already registered? Same email, same account.
              </div>
            </form>
          ) : (
            <div className="stack-form">
              <div className="demo-notice">
                <Sparkles size={18} />
                <div>
                  <strong>Starter preview</strong>
                  <span>
                    Explore the full experience with sample players. Real
                    accounts need your own Supabase project.
                  </span>
                </div>
              </div>
              <button className="primary-btn" onClick={onExplore}>
                Explore working demo <ArrowRight size={18} />
              </button>
              <p className="form-help">
                This preview saves your own demo activity in this browser.
                Sample competitors are labeled.
              </p>
            </div>
          )}
        </section>
      </main>
      <footer className="welcome-footer">
        PINGPOD MORRISVILLE{" "}
        <span>COMMUNITY REWARDS PILOT · NOT A BOOKING APP</span>
      </footer>
    </div>
  );
}

function SetupProfile({
  onSave,
  busy,
  error,
}: {
  onSave: (name: string, show: boolean) => void;
  busy: boolean;
  error: string;
}) {
  const [name, setName] = useState("");
  const [show, setShow] = useState(true);
  return (
    <div className="center-page">
      <Logo />
      <section className="card setup-card">
        <Pill pink>ONE LAST THING</Pill>
        <h1>What should we call you?</h1>
        <p>
          Pick a name your friends will recognize on the leaderboard. Your email
          stays private.
        </p>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name, show);
          }}
        >
          <label htmlFor="display-name">Leaderboard nickname</label>
          <input
            id="display-name"
            autoFocus
            maxLength={22}
            placeholder="e.g. SpinDoctor"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
            />{" "}
            Show my nickname and totals on public leaderboards
          </label>
          {error && <div className="error-msg">{error}</div>}
          <button
            className="primary-btn"
            disabled={busy || name.trim().length < 2}
          >
            Let's play <ArrowRight size={18} />
          </button>
        </form>
      </section>
    </div>
  );
}

function LeaderRows({
  rows,
  ownId,
  demoMode,
  compact = false,
}: {
  rows: Ranking[];
  ownId?: string;
  demoMode: boolean;
  compact?: boolean;
}) {
  if (!rows.length)
    return (
      <EmptyState
        icon={<Trophy />}
        title="The board is wide open"
        text="Be the first to log some minutes this week."
      />
    );
  return (
    <div className={`leader-rows ${compact ? "leader-rows-compact" : ""}`}>
      {rows.slice(0, compact ? 4 : 30).map((player, index) => (
        <div
          className={`leader-row ${player.id === ownId ? "leader-own" : ""}`}
          key={player.id}
        >
          <span className={`place place-${index + 1}`}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className={`avatar avatar-${index % 4}`}>
            {player.display_name.slice(0, 2).toUpperCase()}
          </div>
          <div className="leader-identity">
            <strong>
              {player.display_name}
              {player.id === ownId && <small> YOU</small>}
            </strong>
            <span>
              {player.sessions} sessions{" "}
              {demoMode && player.id !== ownId ? "· sample" : ""}
            </span>
          </div>
          <div className="leader-score">
            <strong>{Number(player.minutes).toLocaleString()}</strong>
            <span>MIN</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamRows({
  rows,
  compact = false,
  demoMode = false,
}: {
  rows: TeamRanking[];
  compact?: boolean;
  demoMode?: boolean;
}) {
  if (!rows.length)
    return (
      <EmptyState
        icon={<Users />}
        title="No crews yet"
        text="Create a crew and be first on the board."
      />
    );
  return (
    <div className="leader-rows">
      {rows.slice(0, compact ? 3 : 30).map((team, index) => (
        <div className="leader-row" key={team.id}>
          <span className={`place place-${index + 1}`}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="team-avatar">
            <Users size={19} />
          </div>
          <div className="leader-identity">
            <strong>{team.name}</strong>
            <span>
              {team.members} members{" "}
              {demoMode && team.id.startsWith("demo-t") ? "· sample" : ""}
            </span>
          </div>
          <div className="leader-score">
            <strong>{Number(team.minutes).toLocaleString()}</strong>
            <span>MIN</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PeriodTabs({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Leaderboard period">
      {(
        [
          ["week", "This week"],
          ["month", "Month"],
          ["all", "All time"],
        ] as const
      ).map(([period, label]) => (
        <button
          type="button"
          aria-pressed={value === period}
          key={period}
          className={value === period ? "selected" : ""}
          onClick={() => onChange(period)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function LogDialog({
  onClose,
  onSubmit,
  busy,
  error,
}: {
  onClose: () => void;
  onSubmit: (day: string, minutes: number) => void;
  busy: boolean;
  error: string;
}) {
  const [day, setDay] = useState(dayKey(new Date()));
  const [minutes, setMinutes] = useState(60);
  const max = dayKey(new Date());
  const min = dayKey(new Date(Date.now() - 7 * 86400000));
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-title"
      >
        <button
          className="icon-btn modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={21} />
        </button>
        <Pill pink>ADD A SESSION</Pill>
        <h2 id="log-title">Already played?</h2>
        <p>Log your minutes in a few taps.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(day, minutes);
          }}
          className="stack-form"
        >
          <label htmlFor="session-day">When did you play?</label>
          <input
            id="session-day"
            type="date"
            min={min}
            max={max}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            required
          />
          <label htmlFor="session-minutes">How long did you play?</label>
          <div className="duration-picks">
            {[30, 60, 90, 120].map((value) => (
              <button
                type="button"
                key={value}
                className={minutes === value ? "active" : ""}
                onClick={() => setMinutes(value)}
              >
                {value} min
              </button>
            ))}
          </div>
          <div className="minute-input">
            <input
              id="session-minutes"
              type="number"
              min={5}
              max={180}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
            <span>minutes</span>
          </div>
          {error && (
            <div className="error-msg" role="alert">
              {error}
            </div>
          )}
          <button
            disabled={busy || !day || minutes < 5 || minutes > 180}
            className="primary-btn"
          >
            {busy ? "Saving…" : "Save session"} <Check size={18} />
          </button>
          <p className="form-help">
            Self-reported minutes appear in the community rankings. A manager
            can verify them for official rewards.
          </p>
        </form>
      </section>
    </div>
  );
}

function Display({ boards, demoMode }: { boards: Boards; demoMode: boolean }) {
  const [qr, setQr] = useState("");
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const origin =
    window.location.origin +
    window.location.pathname.replace(/\/display\/?$/, "/");
  useEffect(() => {
    void QRCode.toDataURL(origin, {
      width: 300,
      margin: 1,
      color: { dark: "#181818", light: "#ffffff" },
    }).then(setQr);
  }, [origin]);
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setSlide((s) => (s + 1) % 2), 15000);
    return () => window.clearInterval(id);
  }, [paused]);
  return (
    <div className="display-page">
      <header className="display-header">
        <Logo light />
        <div className="display-label">
          MORRISVILLE <span>COMMUNITY LEADERBOARD</span>
        </div>
        <Pill pink>LIVE COMMUNITY BOARD</Pill>
      </header>
      <div className="display-content">
        <section className="display-ranking">
          <div className="eyebrow light-eyebrow">
            <span className="eyebrow-line" /> THE MORRISVILLE CHALLENGE
          </div>
          <h1>
            {slide === 0 ? (
              <>
                THE <em>PLAYERS.</em>
              </>
            ) : (
              <>
                THE <em>CREWS.</em>
              </>
            )}
          </h1>
          <p>
            {slide === 0
              ? "Most minutes played this week"
              : "Teams putting in the hours this week"}
          </p>
          <div className="display-list">
            {slide === 0 ? (
              <LeaderRows
                rows={boards.players.slice(0, 5)}
                demoMode={demoMode}
              />
            ) : (
              <TeamRows rows={boards.teams.slice(0, 5)} demoMode={demoMode} />
            )}
          </div>
          <div className="display-disclaimer">
            Community minutes are self-reported until verified.{" "}
            {demoMode ? "DEMO · sample scores" : ""}
          </div>
        </section>
        <aside className="display-join">
          <div className="display-ball">●</div>
          <div className="join-eyebrow">WANT TO SEE YOUR NAME HERE?</div>
          <h2>
            SCAN.
            <br />
            PLAY.
            <br />
            <em>CLIMB.</em>
          </h2>
          {qr && (
            <div className="qr-box">
              <img src={qr} alt="QR code to join PingPod Morrisville Rewards" />
            </div>
          )}
          <strong>Scan to join the challenge</strong>
          <span>No download needed.</span>
        </aside>
      </div>
      <footer className="display-footer">
        <span>PLAY MORE. TOGETHER.</span>
        <div className="display-dots">
          <span className={slide === 0 ? "current" : ""} />
          <span className={slide === 1 ? "current" : ""} />
        </div>
        <button onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={16} /> : <PauseCircle size={16} />}{" "}
          {paused ? "Resume rotation" : "Pause rotation"}
        </button>
      </footer>
    </div>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Something went wrong. Try again.";
}

export default function App() {
  const [user, setUser] = useState<import("@supabase/supabase-js").User | null>(
    null,
  );
  const [authLoading, setAuthLoading] = useState(isConfigured);
  const [demoEntered, setDemoEntered] = useState(
    () => localStorage.getItem("pingpod-demo-entered") === "1",
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [boards, setBoards] = useState<Boards>(EMPTY_BOARDS);
  const [period, setPeriod] = useState<Period>("week");
  const [view, setView] = useState<View>("home");
  const [logging, setLogging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [now, setNow] = useState(Date.now());
  const [admin, setAdmin] = useState(false);
  const [pending, setPending] = useState<PendingSession[]>([]);
  const [boardUpdated, setBoardUpdated] = useState(true);
  const demoMode = !isConfigured;
  const activeSession = sessions.find((s) => s.status === "active");
  const loggedIn = demoMode ? demoEntered : Boolean(user);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) {
        setUser(data.user);
        setAuthLoading(false);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        setAuthLoading(false);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (demoMode) {
      const state = demo.get();
      setProfile(state.profile);
      setSessions(state.sessions);
      setTeam(state.team);
      setBoards(demo.boards(period));
      setBoardUpdated(true);
      return;
    }
    const boardPromise = getBoards(period);
    if (!user) {
      const publicBoard = await boardPromise;
      setBoards(publicBoard);
      setBoardUpdated(true);
      return;
    }
    const [state, nextBoards, isAdmin] = await Promise.all([
      getMyState(user),
      boardPromise,
      getAdminStatus(),
    ]);
    setProfile(state.profile);
    setSessions(state.sessions);
    setTeam(state.team);
    setBoards(nextBoards);
    setAdmin(isAdmin);
    setBoardUpdated(true);
    if (isAdmin) setPending(await getPending());
  }, [demoMode, period, user]);

  useEffect(() => {
    let cancelled = false;
    void refresh().catch(() => {
      if (!cancelled) setBoardUpdated(false);
    });
    const id = window.setInterval(
      () => void refresh().catch(() => setBoardUpdated(false)),
      DISPLAY_MODE ? 15000 : 45000,
    );
    const onVisibility = () => {
      if (!document.hidden) void refresh().catch(() => setBoardUpdated(false));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (!activeSession) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeSession]);

  useEffect(() => {
    if (!demoMode) return;
    const handler = () => void refresh();
    window.addEventListener("pingpod-demo-update", handler);
    return () => window.removeEventListener("pingpod-demo-update", handler);
  }, [demoMode, refresh]);

  async function act(fn: () => Promise<unknown> | unknown, message = "") {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      await fn();
      await refresh();
      setFlash(message);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const userMinutes = useMemo(() => totalMinutes(sessions), [sessions]);
  const weekMinutes = useMemo(() => thisWeekMinutes(sessions), [sessions]);
  const streak = useMemo(() => weeklyStreak(sessions), [sessions]);
  const myRank =
    boards.players.findIndex((row) => row.id === (user?.id ?? "demo-you")) + 1;

  if (DISPLAY_MODE) return <Display boards={boards} demoMode={demoMode} />;
  if (authLoading)
    return (
      <div className="loading-page">
        <Logo />
        <span>Loading your account…</span>
      </div>
    );
  if (!loggedIn)
    return (
      <Welcome
        onExplore={() => {
          localStorage.setItem("pingpod-demo-entered", "1");
          setDemoEntered(true);
          void refresh();
        }}
      />
    );
  if (!profile)
    return (
      <SetupProfile
        busy={busy}
        error={error}
        onSave={(name, show) =>
          void act(
            () =>
              demoMode
                ? demo.saveProfile(name, show)
                : saveProfile(user!, name, show),
            "Welcome to the challenge!",
          )
        }
      />
    );

  const start = () =>
    void act(
      () => (demoMode ? demo.start() : startSession()),
      "Session started!",
    );
  const stop = () =>
    void act(
      () =>
        demoMode
          ? demo.stop(activeSession!.id)
          : stopSession(activeSession!.id),
      "Session saved. Nice work!",
    );
  const submitLog = (day: string, minutes: number) =>
    void act(
      () => (demoMode ? demo.log(day, minutes) : logSession(day, minutes)),
      "Minutes logged. Keep it up!",
    ).then((ok) => {
      if (ok) setLogging(false);
    });

  return (
    <div className="app-page">
      {demoMode && (
        <div className="demo-banner">
          PREVIEW MODE <span>·</span> Sample competitors and browser-only data.
          Connect Supabase for real accounts.
        </div>
      )}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <Logo />
            <span className="header-divider" />
            <span className="location-name">
              MORRISVILLE <small>REWARDS BETA</small>
            </span>
          </div>
          <div className="header-actions">
            <Pill pink>
              <span className="live-dot" /> THE CHALLENGE IS ON
            </Pill>
            <button
              title="Profile"
              aria-label="Profile"
              className="profile-bubble"
              onClick={() => setView("profile")}
            >
              {profile.display_name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </div>
      </header>
      <main className="app-container">
        {flash && (
          <div className="success-toast" role="status">
            <CheckCircle2 size={17} />
            {flash}
            <button aria-label="Dismiss" onClick={() => setFlash("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {error && (
          <div className="error-toast" role="alert">
            {error}
            <button aria-label="Dismiss" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}

        {view === "home" && (
          <>
            <div className="section-head">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-line" /> YOUR HOME COURT
                </div>
                <h1>
                  Hey, {profile.display_name}
                  <span className="wave">.</span>
                </h1>
                <p>Every rally adds up. Let's make today count.</p>
              </div>
              <Pill>SEASON 01</Pill>
            </div>

            <section className={`play-panel ${activeSession ? "playing" : ""}`}>
              <div className="play-panel-content">
                <span className="play-kicker">
                  {activeSession ? (
                    <>
                      <span className="pulse-dot" /> SESSION IN PROGRESS
                    </>
                  ) : (
                    "READY WHEN YOU ARE"
                  )}
                </span>
                <h2>
                  {activeSession ? (
                    "Keep the rally going."
                  ) : (
                    <>
                      Your time.
                      <br />
                      <em>Your game.</em>
                    </>
                  )}
                </h2>
                <p>
                  {activeSession
                    ? "Your time is saved, even if you leave this page."
                    : "Start a timer when you play, or add a session you already finished."}
                </p>
                {activeSession && (
                  <div className="live-timer" aria-live="off">
                    {String(
                      Math.floor(
                        Math.max(
                          0,
                          now - new Date(activeSession.started_at).getTime(),
                        ) / 3600000,
                      ),
                    ).padStart(2, "0")}
                    :
                    {String(
                      Math.floor(
                        Math.max(
                          0,
                          now - new Date(activeSession.started_at).getTime(),
                        ) / 60000,
                      ) % 60,
                    ).padStart(2, "0")}
                    :
                    {String(
                      Math.floor(
                        Math.max(
                          0,
                          now - new Date(activeSession.started_at).getTime(),
                        ) / 1000,
                      ) % 60,
                    ).padStart(2, "0")}
                  </div>
                )}
                <div className="play-actions">
                  {activeSession ? (
                    <button className="pink-btn" disabled={busy} onClick={stop}>
                      <PauseCircle size={19} /> Finish session
                    </button>
                  ) : (
                    <button
                      className="pink-btn"
                      disabled={busy}
                      onClick={start}
                    >
                      <Play size={18} fill="currentColor" /> Start playing
                    </button>
                  )}
                  {!activeSession && (
                    <button
                      className="outline-light-btn"
                      onClick={() => {
                        setError("");
                        setLogging(true);
                      }}
                    >
                      <Plus size={18} /> Log past play
                    </button>
                  )}
                </div>
                {activeSession && (
                  <small className="play-note">
                    Timer sessions are capped at 180 minutes for this beta.
                  </small>
                )}
              </div>
              <div className="panel-art" aria-hidden="true">
                <div className="court-outline">
                  <span />
                  <span />
                </div>
                <div className="ping-ball" />
              </div>
            </section>

            <section className="stats-grid" aria-label="Your play stats">
              <div className="stat-card">
                <div className="stat-label">
                  <Clock3 size={17} /> THIS WEEK
                </div>
                <div className="stat-number">
                  {weekMinutes}
                  <span>min</span>
                </div>
                <div className="stat-foot">Time on the table</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">
                  <Flame size={17} /> WEEKLY STREAK
                </div>
                <div className="stat-number">
                  {streak}
                  <span>wks</span>
                </div>
                <div className="stat-foot">Consecutive weeks played</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">
                  <Trophy size={17} /> YOUR RANK
                </div>
                <div className="stat-number">{myRank ? `#${myRank}` : "—"}</div>
                <div className="stat-foot">Community weekly board</div>
              </div>
            </section>

            <div className="two-column">
              <section className="card leader-card">
                <div className="card-title-row">
                  <div>
                    <div className="eyebrow">THE COMPETITION</div>
                    <h2>
                      Top players <Medal size={21} />
                    </h2>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => setView("rankings")}
                  >
                    Full board <ChevronRight size={18} />
                  </button>
                </div>
                <LeaderRows
                  rows={boards.players}
                  ownId={user?.id ?? "demo-you"}
                  demoMode={demoMode}
                  compact
                />
              </section>
              <section className="card crew-card">
                <div className="card-title-row">
                  <div>
                    <div className="eyebrow">BETTER TOGETHER</div>
                    <h2>
                      Your crew <Users size={22} />
                    </h2>
                  </div>
                </div>
                {team ? (
                  <>
                    <div className="my-team-name">
                      <div className="team-avatar">
                        <Users size={22} />
                      </div>
                      <div>
                        <strong>{team.name}</strong>
                        <span>You're on the team!</span>
                      </div>
                    </div>
                    <div className="crew-score">
                      <span>YOUR TOTAL CONTRIBUTION</span>
                      <strong>
                        {userMinutes}
                        <small> MIN</small>
                      </strong>
                    </div>
                    <button
                      className="secondary-btn"
                      onClick={() => setView("teams")}
                    >
                      View your crew <ArrowRight size={17} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="crew-illustration">
                      <div className="mini-avatar">S</div>
                      <div className="mini-avatar">P</div>
                      <div className="mini-avatar">+</div>
                    </div>
                    <h3>Good games. Better together.</h3>
                    <p>
                      Create a crew or join your friends and chase the team
                      leaderboard.
                    </p>
                    <button
                      className="secondary-btn"
                      onClick={() => setView("teams")}
                    >
                      Find your crew <ArrowRight size={17} />
                    </button>
                  </>
                )}
              </section>
            </div>
            <div className="small-print">
              <ShieldCheck size={16} /> Rankings currently include self-reported
              sessions. Approved sessions can be verified by the Morrisville
              pilot manager.
            </div>
          </>
        )}

        {view === "rankings" && (
          <>
            <div className="section-head">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-line" /> THE MORRISVILLE CHALLENGE
                </div>
                <h1>
                  Leaderboard<span className="wave">.</span>
                </h1>
                <p>Every minute moves you forward.</p>
              </div>
              <Trophy className="page-icon" size={35} />
            </div>
            <section className="card full-card">
              <div className="card-title-row">
                <div>
                  <h2>Most minutes</h2>
                  <p>Community play time · self-reported</p>
                </div>
                <PeriodTabs value={period} onChange={setPeriod} />
              </div>
              <LeaderRows
                rows={boards.players}
                ownId={user?.id ?? "demo-you"}
                demoMode={demoMode}
              />
            </section>
            <div className="small-print">
              <ShieldCheck size={16} /> Minutes are self-reported until
              confirmed. SPINDEX is a separate official rating, not calculated
              here.
            </div>
          </>
        )}

        {view === "teams" && (
          <>
            <div className="section-head">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-line" /> THE CREW CHALLENGE
                </div>
                <h1>
                  Play together<span className="wave">.</span>
                </h1>
                <p>Bring your people. Make your minutes count.</p>
              </div>
              <Users className="page-icon" size={36} />
            </div>
            <div className="two-column teams-layout">
              <section className="card full-card">
                <div className="card-title-row">
                  <div>
                    <h2>Team standings</h2>
                    <p>Collective play time this week</p>
                  </div>
                </div>
                <TeamRows rows={boards.teams} demoMode={demoMode} />
              </section>
              <section className="card team-manage-card">
                <Pill pink>
                  {team ? "YOU ARE IN A CREW" : "JOIN THE COMPETITION"}
                </Pill>
                {team ? (
                  <>
                    <h2>{team.name}</h2>
                    <p>
                      Invite friends to join you. Everyone's play minutes help
                      the crew climb.
                    </p>
                    <div className="invite-code">
                      <span>INVITE CODE</span>
                      <strong>{team.invite_code}</strong>
                      <button
                        title="Copy invite code"
                        onClick={() => {
                          void navigator.clipboard?.writeText(team.invite_code);
                          setFlash("Code copied!");
                        }}
                      >
                        <Copy size={17} />
                      </button>
                    </div>
                    {team.owner_id !== (user?.id ?? "demo-you") && (
                      <button
                        className="subtle-btn"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => (demoMode ? demo.leaveTeam() : leaveTeam()),
                            "You left the crew.",
                          )
                        }
                      >
                        Leave crew
                      </button>
                    )}
                  </>
                ) : (
                  <TeamForm
                    busy={busy}
                    onCreate={(name) =>
                      void act(
                        () =>
                          demoMode ? demo.createTeam(name) : createTeam(name),
                        "Crew created!",
                      )
                    }
                    onJoin={(code) =>
                      void act(
                        () => (demoMode ? demo.joinTeam(code) : joinTeam(code)),
                        "You joined a crew!",
                      )
                    }
                  />
                )}
              </section>
            </div>
          </>
        )}

        {view === "profile" && (
          <>
            <div className="section-head">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-line" /> YOUR GAME, YOUR RULES
                </div>
                <h1>
                  Your profile<span className="wave">.</span>
                </h1>
                <p>Simple stats and privacy controls.</p>
              </div>
              <UserRound className="page-icon" size={35} />
            </div>
            <section className="card profile-card">
              <div className="profile-top">
                <div className="big-avatar">
                  {profile.display_name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h2>{profile.display_name}</h2>
                  <p>{user?.email ?? "Demo player"} · Morrisville</p>
                </div>
              </div>
              <div className="profile-stats">
                <div>
                  <span>TOTAL MINUTES</span>
                  <strong>{userMinutes}</strong>
                </div>
                <div>
                  <span>SESSIONS LOGGED</span>
                  <strong>
                    {sessions.filter((s) => s.status !== "active").length}
                  </strong>
                </div>
                <div>
                  <span>WEEKLY STREAK</span>
                  <strong>{streak}</strong>
                </div>
              </div>
              <ProfileForm
                profile={profile}
                busy={busy}
                onSave={(name, show) =>
                  void act(
                    () =>
                      demoMode
                        ? demo.saveProfile(name, show)
                        : saveProfile(user!, name, show),
                    "Profile saved!",
                  )
                }
              />
              <div className="profile-actions">
                <button
                  className="subtle-btn"
                  onClick={() => {
                    if (demoMode) {
                      localStorage.removeItem("pingpod-demo-entered");
                      setDemoEntered(false);
                    } else void supabase?.auth.signOut();
                  }}
                >
                  <LogOut size={17} /> Sign out
                </button>
              </div>
            </section>
            <section className="card history-card">
              <h2>Recent sessions</h2>
              {sessions.filter((s) => s.status !== "active").length === 0 ? (
                <EmptyState
                  icon={<CalendarDays />}
                  title="No sessions yet"
                  text="Your table time will show up here."
                />
              ) : (
                sessions
                  .filter((s) => s.status !== "active")
                  .slice(0, 8)
                  .map((s) => (
                    <div key={s.id} className="history-row">
                      <div className="history-icon">
                        <Activity size={19} />
                      </div>
                      <div>
                        <strong>
                          {new Date(s.started_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            timeZone: "America/New_York",
                          })}
                        </strong>
                        <span>
                          {s.method === "timer"
                            ? "Timer session"
                            : "Manual entry"}{" "}
                          · {s.status}
                        </span>
                      </div>
                      <strong>{s.minutes} min</strong>
                    </div>
                  ))
              )}
            </section>
          </>
        )}

        {view === "admin" && admin && (
          <>
            <div className="section-head">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-line" /> MORRISVILLE STAFF
                </div>
                <h1>
                  Review sessions<span className="wave">.</span>
                </h1>
                <p>Confirm or reject player-submitted time.</p>
              </div>
              <ShieldCheck className="page-icon" size={35} />
            </div>
            <section className="card full-card">
              <h2>Pending approvals ({pending.length})</h2>
              {pending.length ? (
                pending.map((s) => (
                  <div key={s.id} className="pending-row">
                    <div>
                      <strong>{s.display_name}</strong>
                      <span>
                        {s.minutes} min · {s.method} ·{" "}
                        {new Date(s.started_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="pending-actions">
                      <button
                        disabled={busy}
                        className="approve"
                        onClick={() =>
                          void act(
                            () => reviewSession(s.id, true),
                            "Session approved",
                          )
                        }
                      >
                        Approve
                      </button>
                      <button
                        disabled={busy}
                        className="reject"
                        onClick={() =>
                          void act(
                            () => reviewSession(s.id, false),
                            "Session rejected",
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={<CheckCircle2 />}
                  title="You're all caught up"
                  text="Nothing is waiting for review."
                />
              )}
            </section>
          </>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {(
          [
            { id: "home", icon: Home, label: "Home" },
            { id: "rankings", icon: Trophy, label: "Rankings" },
            { id: "teams", icon: Users, label: "Crews" },
            { id: "profile", icon: UserRound, label: "Profile" },
            ...(admin
              ? [{ id: "admin" as View, icon: ShieldCheck, label: "Admin" }]
              : []),
          ] satisfies NavItem[]
        ).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            aria-current={view === id ? "page" : undefined}
            onClick={() => {
              setError("");
              setView(id);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <footer className="app-footer">
        <Logo />
        <span>© {new Date().getFullYear()} · MORRISVILLE COMMUNITY BETA</span>
        <a href="/?display=1" target="_blank" rel="noreferrer">
          Open iPad board <ArrowRight size={15} />
        </a>
      </footer>
      {logging && (
        <LogDialog
          onClose={() => setLogging(false)}
          onSubmit={submitLog}
          busy={busy}
          error={error}
        />
      )}
      {!boardUpdated && (
        <div className="offline-banner">
          <CircleHelp size={16} /> Waiting for a connection. Rankings may be out
          of date.
        </div>
      )}
    </div>
  );
}

function TeamForm({
  busy,
  onCreate,
  onJoin,
}: {
  busy: boolean;
  onCreate: (name: string) => void;
  onJoin: (code: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <>
      <h2>A little friendly rivalry.</h2>
      <p>Make a crew, or join a friend with their invite code.</p>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name);
        }}
      >
        <label htmlFor="crew-name">Create a crew</label>
        <input
          id="crew-name"
          placeholder="Your crew name"
          maxLength={26}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="secondary-btn"
          disabled={busy || name.trim().length < 3}
        >
          Create crew <Plus size={17} />
        </button>
      </form>
      <div className="form-divider">OR</div>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          onJoin(code);
        }}
      >
        <label htmlFor="invite">Have an invite code?</label>
        <input
          id="invite"
          placeholder="Enter 8-character code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={8}
        />
        <button className="outline-btn" disabled={busy || code.length !== 8}>
          Join crew <ArrowRight size={17} />
        </button>
      </form>
    </>
  );
}

function ProfileForm({
  profile,
  busy,
  onSave,
}: {
  profile: Profile;
  busy: boolean;
  onSave: (name: string, show: boolean) => void;
}) {
  const [name, setName] = useState(profile.display_name);
  const [show, setShow] = useState(profile.show_on_leaderboard);
  return (
    <form
      className="stack-form profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(name, show);
      }}
    >
      <label htmlFor="update-name">Display name</label>
      <input
        id="update-name"
        value={name}
        maxLength={22}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
        />{" "}
        Show me on public leaderboards
      </label>
      <button
        className="secondary-btn"
        disabled={busy || name.trim().length < 2}
      >
        Save changes <Check size={17} />
      </button>
    </form>
  );
}
