import { useEffect, useRef } from "react";

// Opening animation: the whole PingPod mark resolves from a soft blur, the pink ball gives
// one small pop in place, the wordmark sweeps in, then the screen dissolves into the app.
// The logo is never split apart. Plays once per visit (browser session), never for people
// who prefer reduced motion, and a tap skips it. The app loads underneath meanwhile.
const KEY = "pingpod-splash-seen";
const DURATION = 1650;

export function shouldShowSplash(): boolean {
  try {
    if (window.sessionStorage.getItem(KEY)) return false;
  } catch {
    /* storage blocked: still fine to show once */
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return true;
}

export default function Splash({ onDone }: { onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => done.current(), DURATION);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="splash" onClick={() => done.current()} aria-hidden="true">
      <div className="splash-inner">
        <svg className="splash-mark" viewBox="18 88 204 64" width="204" height="64">
          <path d="M55 122h62l-35 28H20z" fill="#fff" />
          <path d="M117 122h62l-35 28H82z" fill="var(--pink)" />
          <path d="M55 90h124v32H55z M63 98v16h108V98z" fill="#fff" fillRule="evenodd" />
          <path d="M179 90h41l-41 32z" fill="var(--pink)" />
          <circle className="splash-ball" cx="27.5" cy="97.5" r="7.5" fill="var(--pink)" />
        </svg>
        <div className="splash-word">PINGPOD</div>
        <div className="splash-sub">Morrisville Rewards</div>
      </div>
    </div>
  );
}
