import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Users } from "lucide-react";
import "./celebrate.css";

// Full-screen milestone celebrations. Each kind has its own short animation (about 1–1.5 s) that
// builds to a "climax": the badge lands, confetti bursts and the phone buzzes (where supported),
// then the title and a Nice! button come in. Reduced-motion users get the finished badge at once.

export type CelebrationKind = "sessions" | "hours" | "streak" | "goal" | "crew" | "top5" | "long";

export interface CelebrationSpec {
  kind: CelebrationKind;
  /** Sessions count, hours, or streak days (other kinds ignore it). */
  value?: number;
  title: string;
  subtitle: string;
}

export const ACCENT: Record<CelebrationKind, string> = {
  sessions: "#ff0078",
  hours: "#ffffff",
  streak: "#ff8a3d",
  goal: "#d4ff89",
  crew: "#5ab0ff",
  top5: "#ffd27a",
  long: "#b98cff",
};

/** When the badge lands (ms): confetti, buzz, then the words. */
const CLIMAX: Record<CelebrationKind, number> = {
  sessions: 1250,
  hours: 1300,
  streak: 1350,
  goal: 1100,
  crew: 1250,
  top5: 1300,
  long: 1450,
};

/** The first session has its own, quicker landing. */
const FIRST_CLIMAX = 950;
const climaxOf = (kind: CelebrationKind, value: number) => (kind === "sessions" && value <= 1 ? FIRST_CLIMAX : CLIMAX[kind]);

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Celebration({ spec, onClose }: { spec: CelebrationSpec; onClose: () => void }) {
  const { kind, value = 0, title, subtitle } = spec;
  const titleId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [reduced] = useState(reducedMotion);
  const climaxMs = climaxOf(kind, value);

  useEffect(() => {
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const climax = window.setTimeout(
      () => {
        if (!reduced && canvas.current && stage.current) {
          // Confetti comes out of the badge itself (the ball sits low in the session stages).
          const r = (stage.current.querySelector(".sball") ?? stage.current).getBoundingClientRect();
          burst(canvas.current, r.left + r.width / 2, r.top + r.height / 2, ACCENT[kind]);
          navigator.vibrate?.([18, 40, 28]);
        }
        button.current?.focus({ preventScroll: true });
      },
      reduced ? 0 : climaxMs,
    );
    return () => {
      window.clearTimeout(climax);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [kind, onClose, reduced, climaxMs]);

  return (
    <div
      className={`cel cel-${kind} ${reduced ? "cel-reduced" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ "--accent": ACCENT[kind], "--climax": `${reduced ? 0 : climaxMs}ms` } as CSSProperties}
    >
      <div className="cel-glow" aria-hidden />
      <canvas ref={canvas} className="cel-burst" aria-hidden />
      <div className="cel-stage" ref={stage} aria-hidden>
        {kind === "sessions" && (value <= 1 ? <FirstSessionStage /> : <SessionsStage n={value} reduced={reduced} />)}
        {kind === "hours" && <HoursStage hours={value} reduced={reduced} />}
        {kind === "streak" && <StreakStage days={value} />}
        {kind === "goal" && <GoalStage />}
        {kind === "crew" && <CrewStage />}
        {kind === "top5" && <TopStage reduced={reduced} />}
        {kind === "long" && <LongStage reduced={reduced} />}
      </div>
      <div className="cel-text">
        <p className="cel-kicker">Milestone unlocked</p>
        <h2 id={titleId} className="cel-title">
          {title}
        </h2>
        <p className="cel-sub">{subtitle}</p>
      </div>
      <button ref={button} type="button" className="btn btn-primary btn-lg cel-done" onClick={onClose}>
        Nice!
      </button>
    </div>
  );
}

/** Round badge used at the end of an animation and in lists. */
export function Medal({ kind, children, size = 150 }: { kind: CelebrationKind; children: ReactNode; size?: number }) {
  return (
    <span className="medal" style={{ "--accent": ACCENT[kind], width: size, height: size, fontSize: size * 0.42 } as CSSProperties}>
      <span className="medal-inner">{children}</span>
    </span>
  );
}

// ── Stages ────────────────────────────────────────────────────────────────

/**
 * First session: a spotlight flickers on, the ball drops out of the dark into the light and slams
 * down, and the 1 stamps onto it. Your debut.
 */
function FirstSessionStage() {
  return (
    <div className="st st-sessions st-first">
      <span className="spot" />
      <span className="spot-pool" />
      <span className="sball-shadow first" />
      <span className="ring sball-ring" />
      <span className="sball-y first">
        <span className="sball first">
          <b className="num">1</b>
        </span>
      </span>
    </div>
  );
}

/**
 * Sessions: a ping-pong ball drops in and bounces faster and faster, the count going up on every
 * bounce. The last bounce lands on the milestone number at the climax.
 */
const BOUNCES = [0.34, 0.6, 0.78, 0.9, 1]; // when the ball touches down, as a share of the climax time
function SessionsStage({ n, reduced }: { n: number; reduced: boolean }) {
  const target = Math.max(1, Math.round(n));
  const [hits, setHits] = useState(reduced ? BOUNCES.length : 0);
  useEffect(() => {
    if (reduced) return;
    const timers = BOUNCES.map((f, i) => window.setTimeout(() => setHits(i + 1), f * CLIMAX.sessions));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduced]);
  // Small milestones (the first session) only show their number on the last bounce.
  const shown =
    hits === 0 ? 0 : target < BOUNCES.length ? (hits === BOUNCES.length ? target : 0) : Math.round((target * hits) / BOUNCES.length);
  return (
    <div className="st st-sessions">
      <span className="sball-shadow" />
      <span className="ring sball-ring" />
      <span className="sball-y">
        <span className="sball">
          {shown > 0 && (
            <b key={shown} className="num">
              {shown}
            </b>
          )}
        </span>
      </span>
    </div>
  );
}

/** Hours: a dial sweeps all the way round while the hours count up. */
function HoursStage({ hours, reduced }: { hours: number; reduced: boolean }) {
  const shown = useCountUp(hours, 1150, reduced);
  const C = 2 * Math.PI * 96;
  return (
    <div className="st st-hours">
      <svg viewBox="0 0 240 240">
        <defs>
          <linearGradient id="hours-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff0078" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
        </defs>
        <circle cx="120" cy="120" r="96" fill="#0d0d10" stroke="#24242a" strokeWidth="12" />
        <circle
          className="dial"
          cx="120"
          cy="120"
          r="96"
          fill="none"
          stroke="url(#hours-g)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={C}
          style={{ "--c": C } as CSSProperties}
          transform="rotate(-90 120 120)"
        />
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            className="tick"
            x1="120"
            y1="36"
            x2="120"
            y2="46"
            transform={`rotate(${i * 30} 120 120)`}
            style={{ animationDelay: `${(i / 12) * 1.15}s` }}
          />
        ))}
      </svg>
      <span className="hours-num num">{shown}</span>
      <span className="hours-label">{hours === 1 ? "hour" : "hours"}</span>
    </div>
  );
}

/** Streak: one flame per day lights up, then they pull together into one big flame. */
function StreakStage({ days }: { days: number }) {
  const n = Math.max(1, Math.min(days, 7));
  const step = Math.min(0.14, 0.9 / n);
  return (
    <div className="st st-streak">
      <div className="flames">
        {Array.from({ length: n }, (_, i) => {
          const x = (i - (n - 1) / 2) * 38;
          return (
            <span key={i} className="mini-flame" style={{ "--x": `${x}px`, "--d": `${i * step}s` } as CSSProperties}>
              <FlameIcon />
            </span>
          );
        })}
      </div>
      <span className="big-flame">
        <svg viewBox="0 0 24 24">
          <defs>
            <linearGradient id="flame-g" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ff0078" />
              <stop offset=".55" stopColor="#ff8a3d" />
              <stop offset="1" stopColor="#ffd27a" />
            </linearGradient>
          </defs>
          <path d={FLAME} fill="url(#flame-g)" />
        </svg>
        <b className="num">{days}</b>
      </span>
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="ember"
          style={{ "--ex": `${((i * 37) % 160) - 80}px`, "--ed": `${(i % 6) * 0.22}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}

const FLAME = "M13 2c1 4-.3 6.8-2.7 8.7.2-1.5-.2-2.6-1.2-3.5C7.2 9.5 5 12.1 5 15.4a7 7 0 0 0 14 0C19 10.7 15.8 6 13 2Z";
function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d={FLAME} fill="currentColor" />
    </svg>
  );
}

/** Weekly goal: a ball arcs in and hits the bullseye. */
function GoalStage() {
  return (
    <div className="st st-goal">
      <svg className="target" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="96" fill="#121214" stroke="#d4ff89" strokeWidth="4" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="#3a3a40" strokeWidth="14" />
        <circle cx="100" cy="100" r="44" fill="none" stroke="#d4ff89" strokeWidth="14" />
        <circle cx="100" cy="100" r="18" fill="#d4ff89" />
        <path className="check" d="M86 101 l10 10 l20 -22" fill="none" stroke="#0a0a0a" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="ripple" />
      <span className="ripple ripple-2" />
      <span className="gball-x">
        <span className="gball-y">
          <span className="gball" />
        </span>
      </span>
    </div>
  );
}

/** Crew: four friends spiral in from the edges and lock into a ring around the crew badge. */
function CrewStage() {
  const C = 2 * Math.PI * 84;
  return (
    <div className="st st-crew">
      <svg className="crew-svg" viewBox="0 0 240 240">
        <defs>
          <linearGradient id="crew-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#bfe2ff" />
            <stop offset="1" stopColor="#3b8de0" />
          </linearGradient>
        </defs>
        <circle
          className="crew-track"
          cx="120"
          cy="120"
          r="84"
          fill="none"
          stroke="url(#crew-g)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          style={{ "--c": C } as CSSProperties}
          transform="rotate(-90 120 120)"
        />
      </svg>
      <span className="ring crew-ring" />
      <span className="crew-core">
        <Users strokeWidth={2.2} />
      </span>
      <span className="orbit">
        {[45, 135, 225, 315].map((a) => (
          <span key={a} className="arm" style={{ "--a": `${a}deg` } as CSSProperties}>
            <span className="node" />
          </span>
        ))}
      </span>
    </div>
  );
}

/** Top five: a laurel wreath grows leaf by leaf while the rank closes in from top 20 to top 5. */
function TopStage({ reduced }: { reduced: boolean }) {
  const closed = useCountUp(15, 1250, reduced, linear);
  return (
    <div className="st st-top">
      <svg className="wreath" viewBox="0 0 240 240">
        <defs>
          <linearGradient id="leaf-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff1c9" />
            <stop offset=".5" stopColor="#ffd27a" />
            <stop offset="1" stopColor="#e0a536" />
          </linearGradient>
        </defs>
        <Branch />
        <g transform="matrix(-1 0 0 1 240 0)">
          <Branch />
        </g>
        <path className="wreath-star" d={STAR} fill="#ffd27a" />
      </svg>
      <span className="ring top-ring" />
      <span className="top-rank">
        <small>Top</small>
        <b className="num">{20 - closed}</b>
      </span>
    </div>
  );
}

const linear = (p: number) => p;

/** One side of the wreath: a stem drawn up the left, with pairs of leaves growing bottom to top. */
const LEAF = "M0 0 C6.5 -7 6.5 -20 0 -28 C-6.5 -20 -6.5 -7 0 0 Z";
const STAR = "M120 22 l4.7 9.6 10.6 1.5 -7.7 7.5 1.8 10.5 -9.4 -5 -9.4 5 1.8 -10.5 -7.7 -7.5 10.6 -1.5 Z";
function Branch() {
  const at = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return [120 + 92 * Math.cos(r), 128 + 92 * Math.sin(r)];
  };
  const [sx, sy] = at(100);
  const [ex, ey] = at(244);
  const leaves: { x: number; y: number; rot: number; d: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const deg = 106 + k * 20;
    const [x, y] = at(deg);
    // Pointing up the stem (along its tangent), one leaf tilted out and one in.
    for (const tilt of [-34, 30]) leaves.push({ x, y, rot: deg + 180 + tilt, d: 0.1 + k * 0.12 });
  }
  leaves.push({ x: ex, y: ey, rot: 244 + 180, d: 0.1 + 7 * 0.12 });
  return (
    <g>
      <path className="stem" d={`M${sx.toFixed(1)} ${sy.toFixed(1)} A92 92 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`} pathLength={1} fill="none" />
      {leaves.map((l, i) => (
        <g key={i} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.rot})`}>
          <path className="leaf" d={LEAF} fill="url(#leaf-g)" style={{ "--d": `${l.d.toFixed(2)}s` } as CSSProperties} />
        </g>
      ))}
    </g>
  );
}

/** Long rally (a 2-hour session): the hourglass runs out while the clock races to 2:00:00. */
function LongStage({ reduced }: { reduced: boolean }) {
  const secs = useCountUp(7200, 1300, reduced);
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return (
    <div className="st st-long">
      <svg className="glass" viewBox="0 0 120 170">
        <defs>
          <clipPath id="glass-in">
            <path d={GLASS} />
          </clipPath>
        </defs>
        <path d={GLASS} fill="rgba(255,255,255,.05)" />
        <g clipPath="url(#glass-in)">
          <rect className="sand-top" x="0" y="30" width="120" height="54" fill="#b98cff" />
          <rect className="sand-stream" x="58.5" y="84" width="3" height="76" fill="#b98cff" />
          <rect className="sand-bottom" x="0" y="118" width="120" height="42" fill="#b98cff" />
        </g>
        <path d={GLASS} fill="none" stroke="#e9e4f5" strokeWidth="3" />
        <rect x="2" y="2" width="116" height="10" rx="4" fill="#e9e4f5" />
        <rect x="2" y="158" width="116" height="10" rx="4" fill="#e9e4f5" />
      </svg>
      <span className="long-clock num">
        {h}:{m}:{s}
      </span>
    </div>
  );
}
const GLASS = "M14 12 C14 52 52 72 56 85 C52 98 14 118 14 158 H106 C106 118 68 98 64 85 C68 72 106 52 106 12 Z";

// ── Helpers ───────────────────────────────────────────────────────────────

function useCountUp(target: number, ms: number, reduced: boolean, ease = (p: number) => 1 - Math.pow(1 - p, 3)) {
  const [v, setV] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * ease(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return v;
}

/** Confetti in PingPod colors from (x, y), drawn on a full-screen canvas for ~2 s. */
function burst(canvas: HTMLCanvasElement, x: number, y: number, accent: string) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const colors = [accent, "#ff0078", "#ffffff", "#ff83b3", "#ffd27a"];
  const parts = Array.from({ length: 150 }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 5 + Math.random() * 9;
    return {
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 4,
      c: colors[(Math.random() * colors.length) | 0],
      round: Math.random() < 0.3,
    };
  });
  const t0 = performance.now();
  const life = 2000;
  const frame = (t: number) => {
    const age = t - t0;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const fade = age > life * 0.6 ? 1 - (age - life * 0.6) / (life * 0.4) : 1;
    for (const p of parts) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.28;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.h, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < life) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
  requestAnimationFrame(frame);
}
