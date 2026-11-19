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
const KNOWN_SLIDES: DisplaySlide[] = ["minutes", "spindex", "crews", "streaks", "longest", "highlights"];

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

/** Pilot status line ("Starts Monday, Nov 23" / "Week 2 of 4"), from the admin-set pilot dates. */
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

  // Pilot dates for the header line (anonymous read; a failure just hides it).
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

  // Every board the admin turned on, always in the rotation; an empty board shows its own invitation.
  // Always in this order (Highest SPINDEX right after Most minutes), whatever order the setting lists.
  const slides = useMemo<DisplaySlide[]>(() => {
    const wanted = data?.slides?.length ? data.slides : KNOWN_SLIDES;
    const list = KNOWN_SLIDES.filter((s) => wanted.includes(s));
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

  const joinUrl = displayUrl(appUrl);
  const pilot = pilotLine(settings);

  return (
    <div className={`display ${idle ? "is-idle" : ""}`}>
      <header className="display-head">
        <Logo size="lg" sub="MORRISVILLE" />
        <div className="display-status">
          {api.mode === "demo" && <span className="display-demo">DEMO DATA</span>}
          {pilot && <span className="display-pilot">{pilot}</span>}
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
              <Slide slide={slide} data={data} pilot={pilot} />
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
          <div className="display-qr">{qr ? <img src={qr} alt={`QR code to join: ${joinUrl}`} /> : <div className="display-qr-placeholder" />}</div>
          <div className="display-join-text">
            <div className="display-join-kicker">Scan to join</div>
            <p className="display-join-line">No app download. Track your play, climb the board.</p>
            <div className="display-join-url">{joinUrl}</div>
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
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function Slide({ slide, data, pilot }: { slide: DisplaySlide; data: DisplayData; pilot: string | null }) {
  const week = weekRange(data.week_start);
  const notStarted = Boolean(pilot?.startsWith("Starts"));
  switch (slide) {
    case "minutes": {
      const lead = data.minutes.length > 1 ? data.minutes[0].value - data.minutes[1].value : 0;
      return (
        <SlideFrame title="Most minutes" subtitle="Total playing time this week" chip={week}>
          <PlayerRows
            rows={data.minutes}
            value={(r) => formatNumber(r.value)}
            unit="min"
            meta={(r) => {
              const sessions = r.sessions ? `${r.sessions} ${plural(r.sessions, "session", "sessions")}` : null;
              if (r.rank === 1 && lead > 0) return [sessions, `leads by ${formatNumber(lead)} min`].filter(Boolean).join(" · ");
              return sessions;
            }}
            empty={
              notStarted ? (
                <SlideEmpty title="Be on the board from day one." text="Scan the code now to set up your account." />
              ) : (
                <SlideEmpty title="No minutes logged yet this week." text="Scan, tap Start playing, and take the top spot." />
              )
            }
          />
        </SlideFrame>
      );
    }
    case "streaks":
      return (
        <SlideFrame title="Daily streaks" subtitle="Days in a row with at least one session">
          <PlayerRows
            rows={data.streaks}
            value={(r) => String(r.value)}
            unit={(r) => plural(r.value, "day", "days")}
            meta={(r) => (r.secondary && r.secondary > r.value ? `Best ever ${r.secondary} days` : null)}
            empty={<SlideEmpty title="No streaks running yet." text="Play two days in a row to start one." />}
          />
        </SlideFrame>
      );
    case "longest":
      return (
        <SlideFrame title="Longest session" subtitle="Longest single session this week" chip={week}>
          <PlayerRows
            rows={data.longest}
            value={(r) => formatNumber(r.value)}
            unit="min"
            meta={(r) => (r.detail && /^\d{4}-\d{2}-\d{2}$/.test(r.detail) ? `Played ${weekdayFmt.format(atNoon(r.detail))}` : null)}
            empty={<SlideEmpty title="No sessions yet this week." text="One long session sets the mark." />}
          />
        </SlideFrame>
      );
    case "crews":
      return (
        <SlideFrame title="Crew rankings" subtitle="Combined crew minutes this week" chip={week}>
          <CrewRows rows={data.crews} />
        </SlideFrame>
      );
    case "spindex":
      return (
        <SlideFrame title="Highest SPINDEX" subtitle="Current ratings · self-reported unless marked verified">
          <PlayerRows
            rows={data.spindex ?? []}
            value={(r) => String(r.value)}
            unit=""
            badge={(r) => (r.detail === "verified" ? "Verified" : null)}
            empty={<SlideEmpty title="No ratings on the board yet." text="Add your SPINDEX on the Me tab in the app." />}
          />
        </SlideFrame>
      );
    case "highlights":
      return (
        <SlideFrame title="This week" subtitle="At PingPod Morrisville" chip={week}>
          <Highlights data={data} />
        </SlideFrame>
      );
  }
}

function SlideFrame({ title, subtitle, chip, children }: { title: string; subtitle: string; chip?: string; children: ReactNode }) {
  return (
    <div className="slide">
      <div className="slide-head">
        <h1 className="slide-title">{title}</h1>
        <div className="slide-sub">
          <span>{subtitle}</span>
          {chip && <span className="slide-chip">{chip}</span>}
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

/** One quiet invitation row under a short list, instead of a half-empty board. */
function NextUp({ crews = false, index }: { crews?: boolean; index: number }) {
  return (
    <li className="row row-next" style={{ "--i": index } as CSSProperties} aria-hidden>
      <span className="row-next-text">{crews ? "Your crew could be next" : "Your name could be here"}</span>
      <span className="row-next-cta">Scan to join</span>
    </li>
  );
}

function PlayerRows({
  rows,
  value,
  unit,
  meta,
  badge,
  empty,
}: {
  rows: DisplayPlayer[];
  value: (r: DisplayPlayer) => string;
  unit: string | ((r: DisplayPlayer) => string);
  meta?: (r: DisplayPlayer) => string | null;
  badge?: (r: DisplayPlayer) => string | null;
  empty: ReactNode;
}) {
  if (!rows.length) return <>{empty}</>;
  const shown = rows.slice(0, 8);
  const invite = shown.length <= 4;
  return (
    <ol className="rows rows-players" style={{ gridTemplateRows: rowTemplate(shown.length + (invite ? 1 : 0), invite ? 5 : 6) }}>
      {shown.map((r, i) => {
        const extra = meta?.(r);
        const tag = badge?.(r);
        const u = typeof unit === "function" ? unit(r) : unit;
        return (
          <li
            key={`${r.rank}-${r.display_name}`}
            className={`row ${r.rank <= 3 ? `row-top row-${r.rank}` : ""}`}
            style={{ "--i": i } as CSSProperties}
          >
            <span className="row-rank num">{r.rank}</span>
            <span className={`row-avatar avatar avatar-${r.avatar_color || "pink"}`} aria-hidden>
              {initials(r.display_name)}
            </span>
            <span className="row-name">
              <span className="row-name-line">
                <span className="row-name-text">{r.display_name}</span>
                {tag && <span className="row-badge">{tag}</span>}
              </span>
              {extra && <span className="row-meta">{extra}</span>}
            </span>
            <span className="row-value">
              <span className="num">{value(r)}</span>
              {u && <span className="row-unit">{u}</span>}
            </span>
          </li>
        );
      })}
      {invite && <NextUp index={shown.length} />}
    </ol>
  );
}

function CrewRows({ rows }: { rows: DisplayCrew[] }) {
  if (!rows.length) return <SlideEmpty title="No crew minutes yet this week." text="Start a crew in the app and bring your friends." />;
  const shown = rows.slice(0, 6);
  const invite = shown.length <= 3;
  return (
    <ol className="rows rows-crews" style={{ gridTemplateRows: rowTemplate(shown.length + (invite ? 1 : 0), invite ? 4 : 5) }}>
      {shown.map((c, i) => (
        <li key={`${c.rank}-${c.name}`} className={`row ${c.rank <= 3 ? `row-top row-${c.rank}` : ""}`} style={{ "--i": i } as CSSProperties}>
          <span className="row-rank num">{c.rank}</span>
          <span className="row-name">
            <span className="row-name-text">{c.name}</span>
            <span className="row-meta">
              {c.members} {plural(c.members, "player", "players")} · {formatNumber(c.avg_minutes)} min each
            </span>
          </span>
          <span className="row-value">
            <span className="num">{formatNumber(c.minutes)}</span>
            <span className="row-unit">min</span>
          </span>
        </li>
      ))}
      {invite && <NextUp crews index={shown.length} />}
    </ol>
  );
}

function Highlights({ data }: { data: DisplayData }) {
  const h = data.highlights;
  if (!h.players && !h.sessions) {
    return <SlideEmpty title="The week is just getting started." text="Every session counts toward this week's totals." />;
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
  if (h.top_spindex) leaders.push({ label: "Top SPINDEX", value: String(h.top_spindex.rating), detail: h.top_spindex.display_name });
  const leaderSpan = leaders.length ? 12 / leaders.length : 12;
  return (
    <div className="tiles">
      {counts.map((t, i) => (
        <div key={t.label} className={`tile ${t.accent ? "tile-accent" : ""}`} style={{ gridColumn: "span 3", "--i": i } as CSSProperties}>
          <span className="tile-label">{t.label}</span>
          <span className="tile-value num">{t.value}</span>
        </div>
      ))}
      {leaders.map((t, i) => (
        <div key={t.label} className="tile tile-leader" style={{ gridColumn: `span ${leaderSpan}`, "--i": i + 4 } as CSSProperties}>
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
