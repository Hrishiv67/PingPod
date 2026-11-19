import { useEffect, useRef } from "react";

// Opening animation: the PingPod table slides together, the net rises, the ball drops onto
// the table, then the wordmark appears. Plays once per visit (browser session), never for
// people who prefer reduced motion, and a tap skips it. The app loads underneath meanwhile.
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
        <svg className="splash-mark" viewBox="18 70 204 82" width="204" height="82">
          <path className="sp-left" d="M55 122h62l-35 28H20z" fill="#fff" />
          <path className="sp-right" d="M117 122h62l-35 28H82z" fill="var(--pink)" />
          <path className="sp-net" d="M55 90h124v32H55z M63 98v16h108V98z" fill="#fff" fillRule="evenodd" />
          <path className="sp-wedge" d="M179 90h41l-41 32z" fill="var(--pink)" />
          <circle className="sp-ball" cx="27.5" cy="97.5" r="7.5" fill="var(--pink)" />
        </svg>
        <div className="splash-word">PINGPOD</div>
        <div className="splash-sub">Morrisville Rewards</div>
      </div>
    </div>
  );
}
