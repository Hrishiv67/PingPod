import { useState } from "react";
import { Check, Hourglass, Play, Target, Trophy, Users } from "lucide-react";
import { Logo } from "../components/Logo";
import { Celebration, Medal, type CelebrationSpec } from "./Celebration";
import "../styles/tokens.css";
import "../styles/ui.css";
import "./celebrate.css";

// Preview page (/celebrations, not linked anywhere): every milestone pop-up, to pick favorites
// before they're wired into the app.

const ITEMS: (CelebrationSpec & { group: string })[] = [
  { group: "Sessions", kind: "sessions", value: 1, title: "First session", subtitle: "You're on the board. Welcome to the rally." },
  { group: "Sessions", kind: "sessions", value: 10, title: "10 sessions", subtitle: "Ten times at the table. That's a regular." },
  { group: "Sessions", kind: "sessions", value: 25, title: "25 sessions", subtitle: "Twenty-five sessions in. The tables know you by now." },
  { group: "Sessions", kind: "sessions", value: 50, title: "50 sessions", subtitle: "Fifty. That's PingPod royalty." },
  { group: "Time played", kind: "hours", value: 1, title: "First hour", subtitle: "Sixty minutes of table time, done." },
  { group: "Time played", kind: "hours", value: 5, title: "5 hours", subtitle: "Five hours on the table. The 300 club." },
  { group: "Time played", kind: "hours", value: 10, title: "10 hours", subtitle: "Double digits. Serious table time." },
  { group: "Time played", kind: "hours", value: 20, title: "20 hours", subtitle: "Twenty hours. You basically live here." },
  { group: "Streaks", kind: "streak", value: 3, title: "3-day streak", subtitle: "Three days in a row. Keep the fire going." },
  { group: "Streaks", kind: "streak", value: 7, title: "7-day streak", subtitle: "A full week, every single day." },
  { group: "Big moments", kind: "goal", title: "Weekly goal hit", subtitle: "You hit this week's goal. New week starts Monday." },
  { group: "Big moments", kind: "crew", title: "Crew up", subtitle: "You're in a crew. Your minutes count together now." },
  { group: "Big moments", kind: "top5", title: "Top five", subtitle: "You finished the week in the top five." },
  { group: "Big moments", kind: "long", title: "Long rally", subtitle: "One session, two whole hours. Legendary." },
];

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
