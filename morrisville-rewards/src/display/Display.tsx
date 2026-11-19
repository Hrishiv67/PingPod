import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import { Maximize, Minimize, RefreshCw } from "lucide-react";
import { api, errorText } from "../lib/api";
import type { DisplayCrew, DisplayData, DisplayPlayer, DisplaySlide, Scope } from "../lib/types";
import { Logo, PingPodMark } from "../components/Logo";
import { formatNumber, formatTime, timeAgo } from "../lib/time";
import { displayUrl, isLocalUrl, resolveAppUrl } from "./appUrl";
import "../styles/tokens.css";
import "../styles/ui.css";
import "./display.css";

const POLL_MS = 30_000;
const LIVE_WINDOW_MS = 90_000;
const PING_DEBOUNCE_MS = 2_000;
const IDLE_MS = 3_000;
const KNOWN_SLIDES: DisplaySlide[] = ["minutes", "streaks", "crews", "highlights", "longest"];

const SCOPE_LABEL: Record<Scope, string> = {
  verified: "Minutes logged by players",
  community: "Minutes logged by players",
};

const weekFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekOf = (day: string) => `Week of ${weekFmt.format(new Date(`${day}T12:00:00Z`))}`;

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
  const inflight = useRef(false);

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
    const list = (data?.slides ?? []).filter((s): s is DisplaySlide => KNOWN_SLIDES.includes(s));
    return list.length ? list : ["minutes"];
  }, [data?.slides]);

  const rotationMs = Math.min(60, Math.max(8, Number(data?.rotation_seconds) || 15)) * 1000;
  const current = slideIndex % slides.length;

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

  return (
    <div className={`display ${idle ? "is-idle" : ""}`}>
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

      <main className="display-main">
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
          <div className="display-qr">{qr ? <img src={qr} alt={`QR code to join: ${displayUrl(appUrl)}`} /> : <div className="display-qr-placeholder" />}</div>
          <div className="display-join-text">
            <div className="display-join-kicker">Scan to join</div>
            <p className="display-join-line">No app download. Track your play, climb the board.</p>
            <div className="display-join-url">{displayUrl(appUrl)}</div>
            {isLocalUrl(appUrl) && <div className="display-join-warning">Test address: set the public app URL in Admin → Settings.</div>}
          </div>
        </aside>
      </main>

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
  const scope = data.scope;
  switch (slide) {
    case "minutes":
      return (
        <SlideFrame title="Most minutes" subtitle={`This week · ${weekOf(data.week_start)}`} scope={scope}>
          <PlayerRows
            rows={data.minutes}
            value={(r) => formatNumber(r.value)}
            unit="min"
            meta={(r) => (r.sessions ? `${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}` : null)}
            empty={
              <SlideEmpty
                title="No minutes logged yet this week."
                text="Scan to be first."
              />
            }
          />
        </SlideFrame>
      );
    case "streaks":
      return (
        <SlideFrame title="Longest streaks" subtitle="Weeks in a row with at least one session" scope={scope}>
          <PlayerRows
            rows={data.streaks}
            value={(r) => String(r.value)}
            unit={(r) => (r.value === 1 ? "week" : "weeks")}
            meta={(r) => (r.secondary && r.secondary > r.value ? `Best ${r.secondary}` : null)}
            empty={<SlideEmpty title="No streaks running yet." text="Play once a week to start one." />}
          />
        </SlideFrame>
      );
    case "longest":
      return (
        <SlideFrame title="Longest session" subtitle={`One session, this week · ${weekOf(data.week_start)}`} scope={scope}>
          <PlayerRows
            rows={data.longest}
            value={(r) => formatNumber(r.value)}
            unit="min"
            empty={<SlideEmpty title="No sessions yet this week." text="Scan, tap Start playing, and set the mark." />}
          />
        </SlideFrame>
      );
    case "crews":
      return (
        <SlideFrame title="Top crews" subtitle="Combined minutes this week" scope={scope}>
          <CrewRows rows={data.crews} />
        </SlideFrame>
      );
    case "highlights":
      return (
        <SlideFrame title="This week" subtitle={`At PingPod Morrisville · ${weekOf(data.week_start)}`} scope={scope}>
          <Highlights data={data} />
        </SlideFrame>
      );
  }
}

function SlideFrame({ title, subtitle, scope, children }: { title: string; subtitle: string; scope: Scope; children: ReactNode }) {
  return (
    <div className="slide">
      <div className="slide-head">
        <h1 className="slide-title">{title}</h1>
        <div className="slide-sub">
          <span>{subtitle}</span>
          <span className={`slide-scope slide-scope-${scope}`}>{SCOPE_LABEL[scope]}</span>
        </div>
      </div>
      <div className="slide-body">{children}</div>
    </div>
  );
}

function SlideEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="slide-empty">
      <PingPodMark height={40} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

/** Grid rows: podium places a little taller; at least `minSlots` tracks so 1–2 rows don't balloon. */
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

function PlayerRows({
  rows,
  value,
  unit,
  meta,
  empty,
}: {
  rows: DisplayPlayer[];
  value: (r: DisplayPlayer) => string;
  unit: string | ((r: DisplayPlayer) => string);
  meta?: (r: DisplayPlayer) => string | null;
  empty: ReactNode;
}) {
  if (!rows.length) return <>{empty}</>;
  return (
    <ol className="rows rows-players" style={{ gridTemplateRows: rowTemplate(Math.min(rows.length, 8), 6) }}>
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
    </ol>
  );
}

function CrewRows({ rows }: { rows: DisplayCrew[] }) {
  if (!rows.length) return <SlideEmpty title="No crews on the board yet." text="Start a crew with friends in the app." />;
  return (
    <ol className="rows rows-crews" style={{ gridTemplateRows: rowTemplate(Math.min(rows.length, 6), 5) }}>
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
    </ol>
  );
}

function Highlights({ data }: { data: DisplayData }) {
  const h = data.highlights;
  if (!h.players && !h.sessions) {
    return <SlideEmpty title="The week is just getting started." text="Scan the code, play, and get on the board." />;
  }
  // Row 1: four counts. Row 2: who's leading (only the ones that exist), sharing the width evenly.
  const counts = [
    { label: "Players this week", value: formatNumber(h.players) },
    { label: "Minutes played", value: formatNumber(h.minutes), accent: true },
    { label: "Sessions", value: formatNumber(h.sessions) },
    { label: "New players", value: formatNumber(h.new_players) },
  ];
  const leaders: { label: string; value: string; detail: string }[] = [];
  if (h.longest) leaders.push({ label: "Longest session", value: `${formatNumber(h.longest.minutes)} min`, detail: h.longest.display_name });
  if (h.most_sessions)
    leaders.push({ label: "Most sessions", value: formatNumber(h.most_sessions.sessions), detail: h.most_sessions.display_name });
  if (h.top_crew) leaders.push({ label: "Top crew", value: `${formatNumber(h.top_crew.minutes)} min`, detail: h.top_crew.name });
  const leaderSpan = leaders.length ? 12 / leaders.length : 12;
  return (
    <div className="tiles">
      {counts.map((t) => (
        <div key={t.label} className={`tile ${t.accent ? "tile-accent" : ""}`} style={{ gridColumn: "span 3" }}>
          <span className="tile-label">{t.label}</span>
          <span className="tile-value num">{t.value}</span>
        </div>
      ))}
      {leaders.map((t) => (
        <div key={t.label} className="tile tile-leader" style={{ gridColumn: `span ${leaderSpan}` }}>
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
