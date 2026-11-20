import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { BadgeCheck, Maximize, Minimize, RefreshCw } from "lucide-react";
import { api, avatarUrl, errorText } from "../lib/api";
import { emblemIcon } from "../components/CrewBadge";
import LogoLoader from "../components/LogoLoader";
import type { CrewRow, DisplayData, DisplaySlide, LeaderRow, Period, Scope, Settings } from "../lib/types";
import { Logo, PingPodMark } from "../components/Logo";
import { formatNumber, formatTime, venueDate } from "../lib/time";
import { displayUrl, isLocalUrl, resolveAppUrl } from "./appUrl";
import { tiePlaces } from "../lib/ranks";
import "../styles/tokens.css";
import "../styles/ui.css";
import "./display.css";

// In-venue iPad scoreboard (/display, /?display=1). Signed-out data only. It always rotates like a
// TV board (long lists scroll themselves slowly). People can still tap a board, switch Today / Week /
// Month or scroll: that board then stays up a little longer before the rotation carries on.

const POLL_MS = 30_000;
const LIVE_WINDOW_MS = 90_000;
const PING_DEBOUNCE_MS = 2_000;
const CURSOR_IDLE_MS = 3_000;
const TOUCH_DWELL_MS = 30_000; // how long a board someone picked stays up
const SETTINGS_POLL_MS = 5 * 60_000;
const ROWS = 50;

type Board = DisplaySlide;
type BoardPeriod = Extract<Period, "day" | "week" | "month">;
const ORDER: Board[] = ["minutes", "spindex", "crews", "streaks", "longest", "highlights"];
const TAB: Record<Board, string> = {
  minutes: "Minutes",
  spindex: "SPINDEX",
  crews: "Crews",
  streaks: "Streaks",
  longest: "Longest",
  highlights: "This week",
};
const TITLE: Record<Board, string> = {
  minutes: "Most minutes",
  spindex: "Highest SPINDEX",
  crews: "Crew rankings",
  streaks: "Daily streaks",
  longest: "Longest session",
  highlights: "This week",
};
const HAS_PERIOD: Board[] = ["minutes", "crews", "longest"];
const PERIODS: { value: BoardPeriod; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const WHEN: Record<BoardPeriod, string> = { day: "today", week: "this week", month: "this month" };

const longDayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);

/** Pilot status ("Starts Monday, Nov 23" / "Week 2 of 4"), from the admin-set pilot dates. */
function pilotLine(settings: Settings | null): string | null {
  if (!settings?.pilot_start) return null;
  const today = venueDate();
  const start = settings.pilot_start;
  if (today < start) return `Starts ${longDayFmt.format(atNoon(start))}`;
  const end = settings.pilot_end;
  if (end && today > end) return null;
  const day = 86_400_000;
  const week = Math.floor((atNoon(today).getTime() - atNoon(start).getTime()) / (7 * day)) + 1;
  if (!end) return `Week ${week}`;
  const weeks = Math.max(1, Math.ceil((atNoon(end).getTime() - atNoon(start).getTime() + day) / (7 * day)));
  return `Week ${Math.min(week, weeks)} of ${weeks}`;
}

type Rows = { kind: "players"; rows: LeaderRow[] } | { kind: "crews"; rows: CrewRow[] };

export default function Display() {
  const [data, setData] = useState<DisplayData | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [cursorIdle, setCursorIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [board, setBoard] = useState<Board>("minutes");
  const [period, setPeriod] = useState<BoardPeriod>("week");
  const [manual, setManual] = useState(false);
  const [touchStamp, setTouchStamp] = useState(0);
  const [cache, setCache] = useState<Record<string, Rows>>({});
  const [tick, setTick] = useState(0);
  const inflight = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Pilot dates for the header (anonymous read; a failure just hides it).
  useEffect(() => {
    let cancelled = false;
    const fetchSettings = () =>
      api
        .publicSettings()
        .then((next) => !cancelled && setSettings(next))
        .catch(() => {});
    void fetchSettings();
    const id = window.setInterval(() => void fetchSettings(), SETTINGS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      setData(await api.displayData());
      setLastSuccessAt(Date.now());
      setError(null);
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  // First load, polling backup, refetch when the iPad wakes or reconnects.
  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    const onOnline = () => {
      setOnline(true);
      void load();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [load]);

  // Realtime "standings changed" pings, debounced.
  useEffect(() => {
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.subscribeBoards(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void load(), PING_DEBOUNCE_MS);
      });
    } catch {
      /* polling still keeps the board fresh */
    }
    return () => {
      window.clearTimeout(timer);
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
    };
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("display-mode");
    return () => document.documentElement.classList.remove("display-mode");
  }, []);

  useWakeLock();

  // Hide the cursor and fullscreen button when nobody is touching the screen.
  useEffect(() => {
    let timer = window.setTimeout(() => setCursorIdle(true), CURSOR_IDLE_MS);
    const wake = () => {
      setCursorIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCursorIdle(true), CURSOR_IDLE_MS);
    };
    const events = ["mousemove", "pointerdown", "touchstart", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keyed by content, so refreshing the data every 30 s doesn't restart the rotation timer.
  const slidesKey = (data?.slides ?? []).join(",");
  const boards = useMemo<Board[]>(() => {
    const wanted = slidesKey ? (slidesKey.split(",") as Board[]) : ORDER;
    const list = ORDER.filter((b) => wanted.includes(b));
    return list.length ? list : ["minutes"];
  }, [slidesKey]);
  const current: Board = boards.includes(board) ? board : boards[0];
  const scope: Scope = data?.scope ?? "community";
  const rotationMs = Math.min(60, Math.max(8, Number(data?.rotation_seconds) || 15)) * 1000;
  const boardPeriod: Period = HAS_PERIOD.includes(current) ? period : current === "highlights" ? "week" : "all";
  const cacheKey = `${current}:${boardPeriod}`;

  // Fetch the board being shown (and refresh it whenever the standings change).
  useEffect(() => {
    if (current === "highlights" || !data) return;
    let live = true;
    const request =
      current === "crews"
        ? api.publicCrewBoard(boardPeriod, scope, ROWS).then((rows): Rows => ({ kind: "crews", rows }))
        : api.publicBoard(current, boardPeriod, scope, ROWS).then((rows): Rows => ({ kind: "players", rows }));
    request.then((r) => live && setCache((c) => ({ ...c, [cacheKey]: r }))).catch(() => {});
    return () => {
      live = false;
    };
  }, [current, boardPeriod, scope, cacheKey, tick, data]);

  // Always rotating. A touch keeps the current board up for TOUCH_DWELL_MS, then rotation carries on.
  const dwell = manual ? TOUCH_DWELL_MS : rotationMs;
  useEffect(() => {
    if (boards.length < 2) return;
    const id = window.setTimeout(() => {
      setBoard(boards[(boards.indexOf(current) + 1) % boards.length]);
      setPeriod("week");
      setManual(false);
    }, dwell);
    return () => window.clearTimeout(id);
  }, [current, period, touchStamp, dwell, boards]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [current, boardPeriod]);

  // TV mode: a list longer than the screen turns page by page during its turn (whole rows, so
  // nobody's name sits half cut off), then the next board comes up.
  const shownCount = cache[cacheKey]?.rows.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (manual || !el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max < 24) return;
    const first = el.querySelector<HTMLElement>(".row");
    const list = el.querySelector<HTMLElement>(".rows");
    const gap = list ? parseFloat(getComputedStyle(list).rowGap) || 0 : 0;
    const rowStep = first ? first.getBoundingClientRect().height + gap : el.clientHeight;
    const perPage = Math.max(1, Math.floor(el.clientHeight / rowStep) - 1); // one row stays on screen
    const stops: number[] = [];
    for (let y = perPage * rowStep; y < max; y += perPage * rowStep) stops.push(Math.round(y));
    stops.push(max);
    const MOVE = 900;
    const HOLD_MIN = 3500;
    // Fit as many pages as the board's turn allows, each held at least HOLD_MIN.
    const fit = Math.max(1, Math.min(stops.length, Math.floor((dwell - HOLD_MIN) / (HOLD_MIN + MOVE))));
    const pages = stops.slice(0, fit);
    const hold = (dwell - pages.length * MOVE) / (pages.length + 1);
    let raf = 0;
    const timers: number[] = [];
    const glide = (from: number, to: number) => {
      const t0 = performance.now();
      const frame = (t: number) => {
        const p = Math.min(1, (t - t0) / MOVE);
        el.scrollTop = from + (to - from) * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
        if (p < 1) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    pages.forEach((y, k) => {
      timers.push(window.setTimeout(() => glide(k ? pages[k - 1] : 0, y), hold * (k + 1) + MOVE * k));
    });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [cacheKey, shownCount, manual, dwell]);

  const touch = () => {
    setManual(true);
    setTouchStamp(Date.now());
  };
  const appUrl = resolveAppUrl(data?.public_app_url);
  const qr = useQr(appUrl);
  const live = online && lastSuccessAt !== null && now - lastSuccessAt < LIVE_WINDOW_MS;
  const fullscreenSupported = typeof document.documentElement.requestFullscreen === "function";

  if (!data) {
    return (
      <div className="display display-connecting">
        <LogoLoader size={56} label="Loading the leaderboard" />
        {!loading && (
          <>
            <h1>Connecting to the leaderboard…</h1>
            <p>{online ? error ?? "We couldn't reach the leaderboard yet." : "This screen is offline. Check the Wi‑Fi."}</p>
            <button className="display-retry" onClick={() => void load()}>
              <RefreshCw size={20} aria-hidden /> Try again
            </button>
          </>
        )}
      </div>
    );
  }

  const joinUrl = displayUrl(appUrl);
  const pilot = pilotLine(settings);
  const shown = cache[cacheKey];

  return (
    <div className={`display ${cursorIdle ? "is-idle" : ""}`} onPointerDown={touch}>
      <header className="display-head">
        <Logo size="lg" sub="MORRISVILLE" />
        <div className="display-status">
          {api.mode === "demo" && <span className="display-demo">DEMO</span>}
          {pilot && <span className="display-pilot">{pilot}</span>}
          {live ? (
            <span className="display-live">
              <span className="display-live-dot" aria-hidden /> LIVE
            </span>
          ) : (
            <span className="display-offline" role="status">
              Offline · {lastSuccessAt ? formatTime(new Date(lastSuccessAt).toISOString()) : "earlier"}
            </span>
          )}
        </div>
      </header>

      <main className="display-main">
        <section className="display-board">
          <nav className="board-tabs" aria-label="Leaderboards">
            {boards.map((b) => (
              <button
                key={b}
                type="button"
                className={`board-tab ${b === current ? "on" : ""}`}
                aria-pressed={b === current}
                onClick={() => setBoard(b)}
              >
                {TAB[b]}
              </button>
            ))}
          </nav>

          <div className="board-head">
            <h1 className="board-title">{TITLE[current]}</h1>
            {HAS_PERIOD.includes(current) && (
              <div className="board-periods" role="group" aria-label="Time period">
                {PERIODS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`board-period ${p.value === period ? "on" : ""}`}
                    aria-pressed={p.value === period}
                    onClick={() => setPeriod(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {boards.length > 1 && (
            <div className="board-progress" aria-hidden>
              <span key={`${cacheKey}-${touchStamp}`} style={{ animationDuration: `${dwell}ms` }} />
            </div>
          )}

          <div className="board-body" ref={listRef} onWheel={touch} key={cacheKey}>
            {current === "highlights" ? (
              <Highlights data={data} />
            ) : !shown ? (
              <LogoLoader label="Loading" />
            ) : shown.rows.length === 0 ? (
              <Empty board={current} period={period} />
            ) : shown.kind === "crews" ? (
              <CrewList rows={shown.rows} />
            ) : (
              <PlayerList rows={shown.rows} board={current} />
            )}
          </div>
        </section>

        <aside className="display-join">
          <div className="display-qr">{qr ? <img src={qr} alt={`QR code to join: ${joinUrl}`} /> : <div className="display-qr-placeholder" />}</div>
          <div className="display-join-text">
            <div className="display-join-kicker">Scan to join</div>
            <div className="display-join-url">{joinUrl}</div>
            {isLocalUrl(appUrl) && <div className="display-join-warning">Test address: set the public app URL in Admin → Settings.</div>}
          </div>
        </aside>
      </main>

      {fullscreenSupported && (
        <button
          className="display-fullscreen"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            else void document.documentElement.requestFullscreen().catch(() => {});
          }}
        >
          {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      )}
    </div>
  );
}

// ── Lists ──────────────────────────────────────────────────────────────
function Empty({ board, period }: { board: Board; period: BoardPeriod }) {
  const text =
    board === "spindex"
      ? "No ratings yet."
      : board === "streaks"
        ? "No streaks yet."
        : board === "crews"
          ? `No crew minutes ${WHEN[period]}.`
          : `No minutes ${WHEN[period]} yet.`;
  return (
    <div className="board-empty">
      <PingPodMark height={36} />
      <strong>{text}</strong>
      <span>Scan the code to get on the board.</span>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

function RowAvatar({ name, color, path }: { name: string; color: string; path?: string | null }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : avatarUrl(path);
  return (
    <span className={`row-avatar avatar avatar-${color || "pink"} ${src ? "has-photo" : ""}`} aria-hidden>
      {src ? <img src={src} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

function valueOf(board: Board, r: LeaderRow): { value: string; unit: string } {
  if (board === "streaks") return { value: String(r.value), unit: r.value === 1 ? "day" : "days" };
  if (board === "spindex") return { value: String(r.value), unit: "" };
  return { value: formatNumber(r.value), unit: "min" };
}

function PlayerList({ rows, board }: { rows: LeaderRow[]; board: Board }) {
  const places = tiePlaces(board, rows);
  return (
    <ol className="rows">
      {rows.map((r, i) => {
        const v = valueOf(board, r);
        const place = places[i];
        return (
          <li key={r.user_id} className={`row ${place <= 3 ? `row-top row-${place}` : ""}`} style={{ "--i": Math.min(i, 10) } as CSSProperties}>
            <span className="row-rank num">{place}</span>
            <RowAvatar name={r.display_name} color={r.avatar_color} path={r.avatar_path} />
            <span className="row-name">
              <span className="row-name-text">{r.display_name}</span>
              {board === "spindex" &&
                (r.detail === "verified" ? (
                  <span className="row-tag verified">
                    <BadgeCheck aria-hidden /> Verified
                  </span>
                ) : (
                  <span className="row-tag">Self-reported</span>
                ))}
            </span>
            <span className="row-value">
              <span className="num">{v.value}</span>
              {v.unit && <span className="row-unit">{v.unit}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CrewList({ rows }: { rows: CrewRow[] }) {
  const places = tiePlaces("crews", rows.map((c) => ({ rank: c.rank, value: c.minutes })));
  return (
    <ol className="rows">
      {rows.map((c, i) => {
        const Icon = emblemIcon(c.emblem);
        return (
          <li key={c.crew_id} className={`row ${places[i] <= 3 ? `row-top row-${places[i]}` : ""}`} style={{ "--i": Math.min(i, 10) } as CSSProperties}>
            <span className="row-rank num">{places[i]}</span>
            <span className={`row-emblem avatar-${c.color ?? "pink"}`} aria-hidden>
              <Icon strokeWidth={2.4} />
            </span>
            <span className="row-name">{c.name}</span>
            <span className="row-value">
              <span className="num">{formatNumber(c.minutes)}</span>
              <span className="row-unit">min</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Highlights({ data }: { data: DisplayData }) {
  const h = data.highlights;
  if (!h.players && !h.sessions) {
    return (
      <div className="board-empty">
        <PingPodMark height={36} />
        <strong>The week is just getting started.</strong>
      </div>
    );
  }
  const counts = [
    { label: "Players", value: formatNumber(h.players) },
    { label: "Minutes", value: formatNumber(h.minutes), accent: true },
    { label: "Sessions", value: formatNumber(h.sessions) },
    { label: "New players", value: formatNumber(h.new_players) },
  ];
  const leaders: { label: string; value: string; detail: string }[] = [];
  if (h.longest) leaders.push({ label: "Longest session", value: `${formatNumber(h.longest.minutes)} min`, detail: h.longest.display_name });
  if (h.top_crew) leaders.push({ label: "Top crew", value: `${formatNumber(h.top_crew.minutes)} min`, detail: h.top_crew.name });
  if (h.top_spindex) leaders.push({ label: "Top SPINDEX", value: String(h.top_spindex.rating), detail: h.top_spindex.display_name });
  return (
    <div className="tiles">
      {counts.map((t, i) => (
        <div key={t.label} className={`tile ${t.accent ? "tile-accent" : ""}`} style={{ "--i": i } as CSSProperties}>
          <span className="tile-label">{t.label}</span>
          <span className="tile-value num">{t.value}</span>
        </div>
      ))}
      {leaders.map((t, i) => (
        <div key={t.label} className="tile tile-leader" style={{ "--i": i + 4 } as CSSProperties}>
          <span className="tile-label">{t.label}</span>
          <span className="tile-detail">{t.detail}</span>
          <span className="tile-value num">{t.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────
function useQr(url: string): string {
  const [qr, setQr] = useState("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((src) => {
        if (!cancelled) setQr(src);
      })
      .catch(() => {
        if (!cancelled) setQr("");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return qr;
}

/** Keep the iPad screen on while the board is visible (re-acquired after the tab returns). */
function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (disposed) void sentinel.release().catch(() => {});
      } catch {
        // Not allowed (e.g. low battery mode); Guided Access / Auto-Lock settings cover it.
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}
