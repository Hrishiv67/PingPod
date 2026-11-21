import { useState } from "react";
import { Check, Hourglass, Play, Target, Trophy, Users } from "lucide-react";
import { Logo } from "../components/Logo";
import { Celebration, Medal, type CelebrationSpec } from "./Celebration";
import { MILESTONES } from "./milestones";
import "../styles/tokens.css";
import "../styles/ui.css";
import "./celebrate.css";

// Preview page (/celebrations, not linked anywhere): every milestone pop-up, to pick favorites
// before they're wired into the app.

const ITEMS = MILESTONES;

const GROUPS = [...new Set(ITEMS.map((it) => it.group))];

function preview(it: CelebrationSpec) {
  switch (it.kind) {
    case "sessions":
      return (it.value ?? 0) <= 1 ? <Check strokeWidth={3} /> : <b className="num">{it.value}</b>;
    case "hours":
      return <b className="num">{it.value}h</b>;
    case "streak":
      return <b className="num">{it.value}d</b>;
    case "goal":
      return <Target />;
    case "crew":
      return <Users />;
    case "top5":
      return <Trophy />;
    case "long":
      return <Hourglass />;
  }
}

export default function Gallery() {
  const [playing, setPlaying] = useState<number | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const play = (i: number) => setPlaying(i);
  const close = () => {
    if (queue.length) {
      const [next, ...rest] = queue;
      setQueue(rest);
      setPlaying(null);
      window.setTimeout(() => setPlaying(next), 250);
    } else setPlaying(null);
  };
  return (
    <div className="cel-gallery">
      <header className="cg-head">
        <Logo size="sm" sub="Milestone celebrations · preview" />
      </header>
      <div className="cg-intro">
        <h1>Celebrations</h1>
        <p>Tap one to play it full screen, the way a player sees it.</p>
        <button
          type="button"
          className="btn btn-secondary btn-md"
          onClick={() => {
            setQueue(ITEMS.map((_, i) => i).slice(1));
            play(0);
          }}
        >
          <Play size={16} /> Play all
        </button>
      </div>
      {GROUPS.map((g) => (
        <section key={g} className="cg-section">
          <h2>{g}</h2>
          <div className="cg-grid">
            {ITEMS.map((it, i) =>
              it.group !== g ? null : (
                <button key={i} type="button" className="cg-card" onClick={() => play(i)}>
                  <Medal kind={it.kind} size={84}>
                    {preview(it)}
                  </Medal>
                  <span className="cg-name">{it.title}</span>
                  <span className="cg-play">
                    <Play size={13} fill="currentColor" /> Play
                  </span>
                </button>
              ),
            )}
          </div>
        </section>
      ))}
      {playing !== null && <Celebration key={playing} spec={ITEMS[playing]} onClose={close} />}
    </div>
  );
}
