import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import { Maximize, Minimize, RefreshCw } from "lucide-react";
import { api, errorText } from "../lib/api";
import type { DisplayCrew, DisplayData, DisplayPlayer, DisplaySlide, Settings } from "../lib/types";
import { Logo, PingPodMark } from "../components/Logo";
import { addDays, formatNumber, formatTime, timeAgo, venueDate } from "../lib/time";
import { displayUrl, isLocalUrl, resolveAppUrl } from "./appUrl";
import "../styles/tokens.css";
import "../styles/ui.css";
import "./display.css";

const POLL_MS = 30_000;
const LIVE_WINDOW_MS = 90_000;
const PING_DEBOUNCE_MS = 2_000;
const IDLE_MS = 3_000;
const KNOWN_SLIDES: DisplaySlide[] = ["minutes", "streaks", "crews", "highlights", "longest"];

const SETTINGS_POLL_MS = 5 * 60_000;

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);
/** "Nov 16–22" for the Monday-start week beginning on `day`. */
function weekRange(day: string): string {
  const a = dayFmt.format(atNoon(day));
  const b = dayFmt.format(atNoon(addDays(day, 6)));
  return a.split(" ")[0] === b.split(" ")[0] ? `${a}–${b.split(" ")[1]}` : `${a} – ${b}`;
}

/** Whether a slide has anything real to show (empty categories are skipped, never faked). */
function hasContent(slide: DisplaySlide, d: DisplayData): boolean {
  switch (slide) {
    case "minutes":
      return d.minutes.length > 0;
    case "streaks":
      return d.streaks.length > 0;
    case "longest":
      return d.longest.length > 0;
    case "crews":
      return d.crews.length > 0;
    case "highlights":
      return d.highlights.players > 0 || d.highlights.sessions > 0;
  }
}

/** Pilot status line for the welcome screen, from the admin-set pilot dates. */
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

/**
 * In-venue iPad scoreboard (/display, /?display=1). Uses only the anonymous public client,
 * so it never shows private data even if someone once signed in on this iPad.
 */
export default function Display() {
  const [data, setData] = useState<DisplayData | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [slideIndex, setSlideIndex] = useState(0);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const inflight = useRef(false);

  // Pilot dates for the welcome screen (anonymous read; a failure just hides the date line).
  useEffect(() => {
    let cancelled = false;
    const fetchSettings = () =>
      api
        .publicSettings()
        .then((next) => {
          if (!cancelled) setSettings(next);
        })
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
      const next = await api.displayData();
      setData(next);
      setLastSuccessAt(Date.now());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  // Initial load, polling backup, refetch when the iPad wakes or reconnects.
  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
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

  // Realtime "standings changed" pings (no data in the payload), debounced.
  useEffect(() => {
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.subscribeBoards(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void load(), PING_DEBOUNCE_MS);
      });
    } catch {
      // Realtime unavailable (e.g. demo mode): polling still keeps the board fresh.
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

  // Clock for "Updated x ago" and the live/offline indicator.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // Board page: no page scroll or rubber-banding.
  useEffect(() => {
    document.documentElement.classList.add("display-mode");
    return () => document.documentElement.classList.remove("display-mode");
  }, []);

  useWakeLock();

  // Hide the cursor and the fullscreen button when nobody is touching the screen.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
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

  const slides = useMemo<DisplaySlide[]>(() => {
    if (!data) return [];
    const wanted = (data.slides?.length ? data.slides : KNOWN_SLIDES).filter((s): s is DisplaySlide => KNOWN_SLIDES.includes(s));
    return wanted.filter((s, i) => wanted.indexOf(s) === i && hasContent(s, data));
  }, [data]);

  const rotationMs = Math.min(60, Math.max(8, Number(data?.rotation_seconds) || 15)) * 1000;
  const current = slides.length ? slideIndex % slides.length : 0;

  // Calm rotation; restarts its timer whenever the slide or settings change.
  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setTimeout(() => setSlideIndex((i) => (i + 1) % slides.length), rotationMs);
    return () => window.clearTimeout(id);
  }, [current, slides.length, rotationMs]);

  const appUrl = resolveAppUrl(data?.public_app_url);
  const qr = useQr(appUrl);
  const live = online && lastSuccessAt !== null && now - lastSuccessAt < LIVE_WINDOW_MS;
  const fullscreenSupported = typeof document.documentElement.requestFullscreen === "function";

  if (!data) {
    return (
      <div className="display display-connecting">
        <PingPodMark height={56} />
        <h1>{loading ? "Loading the leaderboard…" : "Connecting to the leaderboard…"}</h1>
        {!loading && (
          <>
            <p>{online ? error ?? "We couldn't reach the leaderboard yet." : "This screen is offline. Check the Wi‑Fi."}</p>
            <button className="display-retry" onClick={() => void load()}>
              <RefreshCw size={20} aria-hidden /> Try again
            </button>
            <p className="display-retry-note">Retrying automatically every 30 seconds.</p>
          </>
        )}
      </div>
    );
  }

  const welcome = slides.length === 0;
  const joinUrl = displayUrl(appUrl);
  const pilot = pilotLine(settings);
  const qrImg = qr ? <img src={qr} alt={`QR code to join: ${joinUrl}`} /> : <div className="display-qr-placeholder" />;
  const localWarning = isLocalUrl(appUrl) ? (
    <div className="display-join-warning">Test address: set the public app URL in Admin → Settings.</div>
  ) : null;

  return (
    <div className={`display ${welcome ? "is-welcome" : "is-board"} ${idle ? "is-idle" : ""}`}>
      <header className="display-head">
        <Logo size="lg" sub="MORRISVILLE" />
        <div className="display-status">
          {api.mode === "demo" && <span className="display-demo">DEMO DATA</span>}
          {live ? (
            <span className="display-live">
              <span className="display-live-dot" aria-hidden /> LIVE
            </span>
          ) : (
            <span className="display-offline" role="status">
              Offline · showing standings from {lastSuccessAt ? formatTime(new Date(lastSuccessAt).toISOString()) : "earlier"}
            </span>
          )}
          {lastSuccessAt && <span className="display-updated">Updated {timeAgo(new Date(lastSuccessAt).toISOString(), now)}</span>}
        </div>
      </header>

      {welcome ? (
        <main className="display-main display-welcome" key="welcome">
          <section className="welcome-copy">
            {pilot && <div className="welcome-kicker">{pilot}</div>}
            <h1 className="welcome-title">
              The competition
              <br />
              <em>starts here.</em>
            </h1>
            <p className="welcome-line">Track your playing time. Compete with friends. Climb the leaderboard.</p>
          </section>
          <aside className="welcome-join">
            <div className="display-qr">{qrImg}</div>
            <div className="welcome-scan">Scan to join</div>
            <div className="display-join-url">{joinUrl}</div>
            {localWarning}
          </aside>
        </main>
      ) : (
        <main className="display-main display-scoreboard" key="board">
          <section className="display-board" aria-live="polite">
            {slides.map((slide, i) => (
              <div key={slide} className={`display-slide ${i === current ? "is-active" : ""}`} aria-hidden={i !== current}>
                <Slide slide={slide} data={data} />
              </div>
            ))}
            {slides.length > 1 && (
              <div className="display-progress" aria-hidden>
                {slides.map((slide, i) => (
                  <span
                    key={`${slide}-${i === current ? slideIndex : "x"}`}
                    className={i === current ? "is-active" : i < current ? "is-done" : ""}
                    style={{ "--rotation": `${rotationMs}ms` } as CSSProperties}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="display-join">
            <div className="display-qr">{qrImg}</div>
            <div className="display-join-text">
              <div className="display-join-kicker">Scan to join</div>
              <div className="display-join-url">{joinUrl}</div>
              {localWarning}
            </div>
          </aside>
        </main>
      )}

      <footer className="display-foot">
        <span>Morrisville Rewards · Beta — a local PingPod Morrisville pilot</span>
        <PingPodMark height={16} />
      </footer>

      {fullscreenSupported && (
        <button
          className="display-fullscreen"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen" : "Full screen"}
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

// ── Slides ─────────────────────────────────────────────────────────────
function Slide({ slide, data }: { slide: DisplaySlide; data: DisplayData }) {
  const week = weekRange(data.week_start);
  switch (slide) {
    case "minutes":
      return (
        <SlideFrame title="Most minutes" subtitle="Total playing time this week" when={week}>
          <PlayerRows
            rows={data.minutes}
            value={(r) => formatNumber(r.value)}
            unit="min"
            meta={(r) => (r.sessions ? `${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}` : null)}
          />
        </SlideFrame>
      );
    case "streaks":
      return (
        <SlideFrame title="Longest streaks" subtitle="Consecutive active weeks">
          <PlayerRows
            rows={data.streaks}
            value={(r) => String(r.value)}
            unit={(r) => (r.value === 1 ? "week" : "weeks")}
            meta={(r) => (r.secondary && r.secondary > r.value ? `Best ${r.secondary} weeks` : null)}
          />
        </SlideFrame>
      );
    case "longest":
      return (
        <SlideFrame title="Longest session" subtitle="Longest single session this week" when={week}>
          <PlayerRows
            rows={data.longest}
            value={(r) => formatNumber(r.value)}
            unit="min"
            meta={(r) => (r.detail && /^\d{4}-\d{2}-\d{2}$/.test(r.detail) ? weekdayFmt.format(atNoon(r.detail)) : null)}
          />
        </SlideFrame>
      );
    case "crews":
      return (
        <SlideFrame title="Top crews" subtitle="Combined crew minutes this week" when={week}>
          <CrewRows rows={data.crews} />
        </SlideFrame>
      );
    case "highlights":
      return (
        <SlideFrame title="This week" subtitle="At PingPod Morrisville" when={week}>
          <Highlights data={data} />
        </SlideFrame>
      );
  }
}

function SlideFrame({ title, subtitle, when, children }: { title: string; subtitle: string; when?: string; children: ReactNode }) {
  return (
    <div className="slide">
      <div className="slide-head">
        <h1 className="slide-title">{title}</h1>
        <div className="slide-sub">
          <span>{subtitle}</span>
          {when && <span className="slide-when">{when}</span>}
        </div>
      </div>
      <div className="slide-body">{children}</div>
    </div>
  );
}

/** Grid rows for longer lists: podium places a little taller; at least `minSlots` tracks so rows don't balloon. */
function rowTemplate(count: number, minSlots: number): string {
  const slots = Math.max(count, minSlots);
  return Array.from({ length: slots }, (_, i) => (i < 3 && i < count ? "minmax(0, 1.18fr)" : "minmax(0, 1fr)")).join(" ");
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

/** Short lists (1–4 rows) get tall rows plus one invitation row instead of a half-empty board. */
const FEW = 4;

function NextUp({ crews = false }: { crews?: boolean }) {
  return (
    <li className="row row-next" aria-hidden>
      <span className="row-next-text">{crews ? "Your crew could be next" : "Your name could be next"}</span>
      <span className="row-next-cta">Scan to join</span>
    </li>
  );
}

function PlayerRows({
  rows,
  value,
  unit,
  meta,
}: {
  rows: DisplayPlayer[];
  value: (r: DisplayPlayer) => string;
  unit: string | ((r: DisplayPlayer) => string);
  meta?: (r: DisplayPlayer) => string | null;
}) {
  const few = rows.length <= FEW;
  return (
    <ol
      className={`rows rows-players ${few ? "rows-few" : ""}`}
      style={few ? undefined : { gridTemplateRows: rowTemplate(Math.min(rows.length, 8), 6) }}
    >
      {rows.slice(0, 8).map((r) => {
        const extra = meta?.(r);
        return (
          <li key={`${r.rank}-${r.display_name}`} className={`row ${r.rank <= 3 ? `row-top row-${r.rank}` : ""}`}>
            <span className="row-rank num">{r.rank}</span>
            <span className={`row-avatar avatar avatar-${r.avatar_color || "pink"}`} aria-hidden>
              {initials(r.display_name)}
            </span>
            <span className="row-name">
              <span className="row-name-text">{r.display_name}</span>
              {extra && <span className="row-meta">{extra}</span>}
            </span>
            <span className="row-value">
              <span className="num">{value(r)}</span>
              <span className="row-unit">{typeof unit === "function" ? unit(r) : unit}</span>
            </span>
          </li>
        );
      })}
      {few && <NextUp />}
    </ol>
  );
}

function CrewRows({ rows }: { rows: DisplayCrew[] }) {
  const few = rows.length <= FEW;
  return (
    <ol
      className={`rows rows-crews ${few ? "rows-few" : ""}`}
      style={few ? undefined : { gridTemplateRows: rowTemplate(Math.min(rows.length, 6), 5) }}
    >
      {rows.slice(0, 6).map((c) => (
        <li key={`${c.rank}-${c.name}`} className={`row ${c.rank <= 3 ? `row-top row-${c.rank}` : ""}`}>
          <span className="row-rank num">{c.rank}</span>
          <span className="row-name">
            <span className="row-name-text">{c.name}</span>
            <span className="row-meta">
              {c.members} {c.members === 1 ? "player" : "players"} · {formatNumber(c.avg_minutes)} min each
            </span>
          </span>
          <span className="row-value">
            <span className="num">{formatNumber(c.minutes)}</span>
            <span className="row-unit">min</span>
          </span>
        </li>
      ))}
      {few && <NextUp crews />}
    </ol>
  );
}

function Highlights({ data }: { data: DisplayData }) {
  const h = data.highlights;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  // Row 1: four counts. Row 2: who's leading (only the ones that exist), sharing the width evenly.
  const counts = [
    { label: "Players this week", value: formatNumber(h.players), unit: plural(h.players, "player", "players") },
    { label: "Total playing time", value: formatNumber(h.minutes), unit: "min", accent: true },
    { label: "Sessions played", value: formatNumber(h.sessions), unit: plural(h.sessions, "session", "sessions") },
    { label: "New this week", value: formatNumber(h.new_players), unit: plural(h.new_players, "player", "players") },
  ];
  const leaders: { label: string; value: string; unit: string; detail: string }[] = [];
  if (h.longest) leaders.push({ label: "Longest session", value: formatNumber(h.longest.minutes), unit: "min", detail: h.longest.display_name });
  if (h.most_sessions)
    leaders.push({
      label: "Most sessions",
      value: formatNumber(h.most_sessions.sessions),
      unit: plural(h.most_sessions.sessions, "session", "sessions"),
      detail: h.most_sessions.display_name,
    });
  if (h.top_crew) leaders.push({ label: "Top crew", value: formatNumber(h.top_crew.minutes), unit: "min", detail: h.top_crew.name });
  const leaderSpan = leaders.length ? 12 / leaders.length : 12;
  return (
    <div className={`tiles ${leaders.length ? "" : "tiles-one-row"}`}>
      {counts.map((t) => (
        <div key={t.label} className={`tile ${t.accent ? "tile-accent" : ""}`} style={{ gridColumn: "span 3" }}>
          <span className="tile-label">{t.label}</span>
          <span className="tile-figure">
            <span className="tile-value num">{t.value}</span>
            <span className="tile-unit">{t.unit}</span>
          </span>
        </div>
      ))}
      {leaders.map((t) => (
        <div key={t.label} className="tile tile-leader" style={{ gridColumn: `span ${leaderSpan}` }}>
          <span className="tile-label">{t.label}</span>
          <span className="tile-detail">{t.detail}</span>
          <span className="tile-figure">
            <span className="tile-value num">{t.value}</span>
            <span className="tile-unit">{t.unit}</span>
          </span>
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
