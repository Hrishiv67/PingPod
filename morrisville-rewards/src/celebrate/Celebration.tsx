import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Trophy, Users } from "lucide-react";
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
  crew: 1150,
  top5: 1200,
  long: 1450,
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Celebration({ spec, onClose }: { spec: CelebrationSpec; onClose: () => void }) {
  const { kind, value = 0, title, subtitle } = spec;
  const titleId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [reduced] = useState(reducedMotion);

  useEffect(() => {
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const climax = window.setTimeout(
      () => {
        if (!reduced && canvas.current && stage.current) {
          const r = stage.current.getBoundingClientRect();
          burst(canvas.current, r.left + r.width / 2, r.top + r.height / 2, ACCENT[kind]);
          navigator.vibrate?.([18, 40, 28]);
        }
        button.current?.focus({ preventScroll: true });
      },
      reduced ? 0 : CLIMAX[kind],
    );
    return () => {
      window.clearTimeout(climax);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [kind, onClose, reduced]);

  return (
    <div
      className={`cel cel-${kind} ${reduced ? "cel-reduced" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ "--accent": ACCENT[kind], "--climax": `${reduced ? 0 : CLIMAX[kind]}ms` } as CSSProperties}
    >
      <div className="cel-glow" aria-hidden />
      <canvas ref={canvas} className="cel-burst" aria-hidden />
      <div className="cel-stage" ref={stage} aria-hidden>
        {kind === "sessions" && <SessionsStage n={value} />}
        {kind === "hours" && <HoursStage hours={value} reduced={reduced} />}
        {kind === "streak" && <StreakStage days={value} />}
        {kind === "goal" && <GoalStage />}
        {kind === "crew" && <CrewStage />}
        {kind === "top5" && <TopStage />}
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

/** Sessions: a quick rally between two paddles speeds up, then the ball becomes the badge. */
function SessionsStage({ n }: { n: number }) {
  return (
    <div className="st st-sessions">
      <Paddle className="pad pad-l" blade="#ff0078" />
      <Paddle className="pad pad-r" blade="#f4f4f6" />
      <span className="ball" />
      <span className="ring" />
      <span className="ring ring-2" />
      <span className="st-medal">
        <Medal kind="sessions">{n <= 1 ? <Check strokeWidth={3} /> : <b className="num">{n}</b>}</Medal>
      </span>
    </div>
  );
}

function Paddle({ className, blade }: { className: string; blade: string }) {
  return (
    <svg className={className} viewBox="0 0 60 100" aria-hidden>
      <rect x="24" y="58" width="12" height="38" rx="5" fill="#5a3b2e" />
      <rect x="24" y="58" width="12" height="10" fill="#3c261d" />
      <ellipse cx="30" cy="32" rx="27" ry="30" fill={blade} />
      <ellipse cx="30" cy="32" rx="27" ry="30" fill="url(#pad-shine)" />
      <defs>
        <radialGradient id="pad-shine" cx="35%" cy="28%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
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

/** Crew: friends fly in from the corners and lock onto the crew badge. */
function CrewStage() {
  const people = [
    { c: "#ff0078", t: "AK", from: [-170, -150], to: [0, -98] },
    { c: "#46d483", t: "MJ", from: [170, -150], to: [98, 0] },
    { c: "#ff8a3d", t: "RT", from: [170, 150], to: [0, 98] },
    { c: "#b98cff", t: "SL", from: [-170, 150], to: [-98, 0] },
  ];
  return (
    <div className="st st-crew">
      <svg className="links" viewBox="-130 -130 260 260">
        {people.map((p, i) => (
          <line key={i} x1="0" y1="0" x2={p.to[0]} y2={p.to[1]} style={{ animationDelay: `${0.75 + i * 0.05}s` }} />
        ))}
      </svg>
      {people.map((p, i) => (
        <span
          key={p.t}
          className="crew-ava"
          style={
            {
              background: p.c,
              "--fx": `${p.from[0]}px`,
              "--fy": `${p.from[1]}px`,
              "--tx": `${p.to[0]}px`,
              "--ty": `${p.to[1]}px`,
              "--d": `${i * 0.09}s`,
            } as CSSProperties
          }
        >
          {p.t}
        </span>
      ))}
      <span className="crew-shield">
        <Users strokeWidth={2.4} />
      </span>
      <span className="ring" />
    </div>
  );
}

/** Top five: the podium rises and the trophy drops onto #1. */
function TopStage() {
  return (
    <div className="st st-top">
      <div className="podium-bars">
        <span className="bar b2">2</span>
        <span className="bar b1">1</span>
        <span className="bar b3">3</span>
      </div>
      <span className="trophy">
        <Trophy strokeWidth={2} />
      </span>
      <span className="shine" />
    </div>
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

function useCountUp(target: number, ms: number, reduced: boolean) {
  const [v, setV] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
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
