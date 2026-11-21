import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ClipboardList, QrCode, X } from "lucide-react";
import { PingPodMark } from "./Logo";
import "./tutorial.css";

// "How it works": four short slides with one simple picture each, then (for signed-in players who
// haven't opened it yet) the research survey ask as the last slide. Shown once on a player's first
// visit, and any time from Me → How it works (or the sign-in page, without the survey slide).
// Swipe, tap Next, or use the arrow keys. "Skip" jumps to the survey slide when there is one.

type Slide = { key: string; title: string; text: string; visual: ReactNode };

const SLIDES: Slide[] = [
  {
    key: "track",
    title: "Track your table time",
    text: "Start the timer when you play. Forgot? Log the session after.",
    visual: <TimerVisual />,
  },
  {
    key: "board",
    title: "Climb the boards",
    text: "More minutes, higher rank. Crews and SPINDEX ratings get boards too. Resets every Monday.",
    visual: <PodiumVisual />,
  },
  {
    key: "rally",
    title: "Keep your week going",
    text: "Each day you play lights a flame. Set a weekly goal to stay on track.",
    visual: <FlamesVisual />,
  },
  {
    key: "screen",
    title: "See your name at PingPod",
    text: "The leaderboard plays on the big screen at PingPod Morrisville.",
    visual: <ScreenVisual />,
  },
];

export default function Tutorial({
  onClose,
  survey,
}: {
  onClose: () => void;
  /** Research survey ask as the final slide (omit when there's no survey or it's been opened). */
  survey?: { ask: string; onOpen: () => void } | null;
}) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const touch = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const slides = useMemo<Slide[]>(
    () =>
      survey
        ? [...SLIDES, { key: "survey", title: "One quick favor", text: survey.ask, visual: <SurveyVisual /> }]
        : SLIDES,
    [survey],
  );
  const last = i === slides.length - 1;
  const slide = slides[i];
  const onSurvey = slide.key === "survey";

  const go = (n: number) => {
    if (n < 0 || n >= slides.length) return;
    setDir(n > i ? "next" : "back");
    setI(n);
  };

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    document.body.classList.add("no-scroll");
    return () => {
      document.body.classList.remove("no-scroll");
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="tut"
      role="dialog"
      aria-modal="true"
      aria-label="How it works"
      tabIndex={-1}
      ref={root}
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? i + 1 : i - 1);
      }}
    >
      <div className="tut-top">
        <PingPodMark height={16} />
        <span className="tut-count num">
          {i + 1} / {slides.length}
        </span>
        <button
          type="button"
          className="tut-skip"
          // Skip goes to the survey slide (when there is one); on the last slide it closes.
          onClick={() => (last ? onClose() : survey ? go(slides.length - 1) : onClose())}
          aria-label={last ? "Close" : undefined}
        >
          {last ? <X size={20} /> : "Skip"}
        </button>
      </div>

      <div key={slide.key} className={`tut-slide tut-${dir}`}>
        <div className="tut-visual" aria-hidden>
          {slide.visual}
        </div>
        <h2 className="tut-title">{slide.title}</h2>
        <p className="tut-text">{slide.text}</p>
      </div>

      <div className="tut-bottom">
        <div className="tut-dots" role="tablist" aria-label="Slides">
          {slides.map((s, n) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-label={`Slide ${n + 1}: ${s.title}`}
              className={n === i ? "on" : ""}
              onClick={() => go(n)}
            />
          ))}
        </div>
        <div className="tut-actions">
          {onSurvey ? (
            <button type="button" className="tut-back" onClick={onClose}>
              Maybe later
            </button>
          ) : i > 0 ? (
            <button type="button" className="tut-back" onClick={() => go(i - 1)}>
              Back
            </button>
          ) : null}
          {onSurvey && survey ? (
            <button
              type="button"
              className="btn btn-primary btn-lg tut-next"
              onClick={() => {
                onClose();
                survey.onOpen();
              }}
            >
              Take the survey
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg tut-next" onClick={() => (last ? onClose() : go(i + 1))}>
              {last ? "Let's play" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pictures (plain shapes in PingPod colors; they animate a little when the slide appears) ──

function TimerVisual() {
  const [s, setS] = useState(42 * 60 + 7);
  useEffect(() => {
    const id = window.setInterval(() => setS((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <div className="tv-timer">
      <span className="tv-live">
        <i /> Playing now
      </span>
      <span className="tv-clock num">
        {mm}:{ss}
      </span>
      <span className="tv-btn">Finish session</span>
    </div>
  );
}

function PodiumVisual() {
  return (
    <div className="tv-podium">
      {[
        { place: 2, h: 110, color: "green", label: "JL" },
        { place: 1, h: 160, color: "pink", label: "YOU" },
        { place: 3, h: 80, color: "blue", label: "SR" },
      ].map((p, k) => (
        <div key={p.place} className="tv-pod" style={{ ["--h" as string]: `${p.h}px`, ["--d" as string]: `${k * 90}ms` }}>
          <span className={`tv-ava avatar-${p.color} ${p.place === 1 ? "me" : ""}`}>{p.label}</span>
          <span className="tv-bar">
            <b className="num">#{p.place}</b>
          </span>
        </div>
      ))}
    </div>
  );
}

function FlamesVisual() {
  const lit = [true, true, false, true, false, false, false];
  return (
    <div className="tv-rally">
      <div className="tv-flames">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, k) => (
          <span key={k} className={lit[k] ? "on" : ""} style={{ ["--d" as string]: `${k * 120}ms` }}>
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path d="M13 2c1 4-.3 6.8-2.7 8.7.2-1.5-.2-2.6-1.2-3.5C7.2 9.5 5 12.1 5 15.4a7 7 0 0 0 14 0C19 10.7 15.8 6 13 2Z" fill="currentColor" />
            </svg>
            {d}
          </span>
        ))}
      </div>
      <span className="tv-goal">
        <span />
      </span>
      <span className="tv-goal-text">1 hr 30 min of 2 hr</span>
    </div>
  );
}



function ScreenVisual() {
  return (
    <div className="tv-screen">
      <div className="tv-screen-rows">
        {[88, 70, 56, 40].map((w, k) => (
          <span key={k} style={{ ["--w" as string]: `${w}%`, ["--d" as string]: `${k * 90}ms` }}>
            <b className="num">{k + 1}</b>
            <i />
          </span>
        ))}
      </div>
      <div className="tv-qr">
        <span>
          <QrCode size={56} strokeWidth={2.2} />
        </span>
      </div>
    </div>
  );
}

function SurveyVisual() {
  return (
    <div className="tv-survey">
      <span className="tv-survey-icon">
        <ClipboardList size={30} />
      </span>
      {[78, 62, 70].map((w, k) => (
        <span key={k} className="tv-survey-row" style={{ ["--d" as string]: `${250 + k * 220}ms` }}>
          <i className="tv-check">
            <Check size={14} strokeWidth={3.2} />
          </i>
          <b style={{ width: `${w}%` }} />
        </span>
      ))}
    </div>
  );
}
