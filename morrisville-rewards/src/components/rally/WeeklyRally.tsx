import { Flag } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { RallyFilm, type BallHandoff } from "./RallyFilm";
import "./weekly-rally.css";

// Weekly Rally: this week at a glance on Home (a flame for each day you played, your minutes and
// rank), plus an optional weekly goal (hours + play days) set in a short full-screen planner:
//   first time: intro film → the 150-minute guide → hours → days → "You're set"
//   editing:    hours → days → "You're set"

export interface RallyActivity {
  /** Morrisville week, Monday first. Only completed, counted play days. */
  playedDays?: readonly boolean[];
  tableMinutes?: number;
}

export interface RallyGoals {
  days?: number;
  hours?: number;
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

/** "2½ hr", "1 hr", "1¼ hr" for whole and quarter hours, otherwise "1 hr 20 min". */
function hoursLabel(hours: number) {
  const whole = Math.floor(hours);
  const frac = Math.round((hours - whole) * 4);
  const mark = ["", "¼", "½", "¾"][frac] ?? "";
  if (frac === 4) return `${whole + 1} hr`;
  return whole || mark ? `${whole || ""}${mark} hr` : duration(Math.round(hours * 60));
}

/** "Goal hit!" / "30 min to go" / "2 days to go" / "30 min · 2 days to go". */
export function goalStatus(activity: RallyActivity, goals: RallyGoals): string | null {
  if (goals.days === undefined || goals.hours === undefined) return null;
  const daysLeft = Math.max(0, goals.days - (activity.playedDays?.filter(Boolean).length ?? 0));
  const minutesLeft = Math.max(0, Math.round(goals.hours * 60) - (activity.tableMinutes ?? 0));
  if (!daysLeft && !minutesLeft) return "Goal hit!";
  if (!minutesLeft) return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`;
  if (!daysLeft) return `${duration(minutesLeft)} to go`;
  return `${duration(minutesLeft)} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`;
}

function Flame({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M13 2c1 4-.3 6.8-2.7 8.7.2-1.5-.2-2.6-1.2-3.5C7.2 9.5 5 12.1 5 15.4a7 7 0 0 0 14 0C19 10.7 15.8 6 13 2Z" fill="currentColor" />
      <path d="M12.9 13c.2 1.4-.3 2.3-1.3 3-.2-.5-.4-.8-.8-1.1-.8.9-1.2 1.8-1.2 2.7a2.6 2.6 0 0 0 5.2 0c0-1.5-.7-3-1.9-4.6Z" className="rally-flame-cutout" />
    </svg>
  );
}


export function WeeklyRally({
  activity,
  goals,
  today,
  rank,
  streak,
  mark,
  onSave,
}: {
  activity: RallyActivity;
  goals: RallyGoals;
  /** 0 = Monday … 6 = Sunday (Morrisville time). */
  today: number;
  /** This week's rank, or null when unranked / hidden. */
  rank: number | null;
  streak: number;
  mark?: ReactNode;
  /** Save the goal (null removes it). Throw to show a retry message. */
  onSave: (goals: { days: number; hours: number } | null) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const detailsId = useId();
  const hasGoal = goals.days !== undefined && goals.hours !== undefined;
  const status = goalStatus(activity, goals);
  const played = activity.playedDays?.filter(Boolean).length ?? 0;
  const minutes = activity.tableMinutes ?? 0;
  const goalMinutes = hasGoal ? Math.round(goals.hours! * 60) : 0;
  const timePct = hasGoal ? Math.min(100, (minutes / goalMinutes) * 100) : 0;
  const hit = status === "Goal hit!";

  return (
    <section className={`rally-card ${hit ? "is-hit" : ""}`} aria-label="Weekly Rally">
      <button className="rally-toggle" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((o) => !o)}>
        <span className="rally-head">
          <span className="rally-title">Weekly Rally</span>
          <span className="rally-sub">{duration(minutes)} this week</span>
        </span>
        {rank ? (
          <span className="rally-rank num" aria-label={`Rank ${rank} this week`}>
            #{rank}
          </span>
        ) : null}
        <span className="rally-chevron" aria-hidden="true" />
      </button>

      <ol className="rally-week" aria-label="Play days this week">
        {weekdays.map((day, index) => {
          const on = activity.playedDays?.[index];
          return (
            <li key={day} className={`${on ? "rally-played" : ""} ${index === today ? "rally-today" : ""}`}>
              <Flame />
              <span>
                {day}
                <span className="rally-sr"> {on ? "played" : index > today ? "coming up" : "no play logged"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {hasGoal ? (
        <button type="button" className="rally-goal" onClick={() => setEditing(true)} aria-label="Weekly goal. Tap to change it.">
          <span className="rally-goal-head">
            <span>
              Goal · {hoursLabel(goals.hours!)} over {goals.days} {goals.days === 1 ? "day" : "days"}
            </span>
            <span className="rally-goal-edit">Edit</span>
          </span>
          <span className="rally-bar" aria-hidden="true">
            <span style={{ width: `${timePct}%` }} />
          </span>
          <span className="rally-goal-line">
            <span className="num">
              {duration(minutes)} · {played} of {goals.days} days
            </span>
            <strong>{status}</strong>
          </span>
        </button>
      ) : (
        <button type="button" className="rally-cta" onClick={() => setEditing(true)}>
          <span className="rally-cta-icon">
            <Flag size={20} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="rally-cta-text">
            <strong>Set a weekly goal</strong>
            <span>Pick your hours and days. Track it right here.</span>
          </span>
          <span className="rally-cta-arrow" aria-hidden="true">
            →
          </span>
        </button>
      )}

      <div id={detailsId} className="rally-details" hidden={!expanded}>
        <dl className="rally-facts">
          <div>
            <dt>Play days</dt>
            <dd className="num">{played}</dd>
          </div>
          <div>
            <dt>Avg per day</dt>
            <dd className="num">{played ? duration(Math.round(minutes / played)) : "—"}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd className="num">
              {streak} {streak === 1 ? "day" : "days"}
            </dd>
          </div>
        </dl>
        <p className="rally-note">Weeks start Monday. Every day you play lights a flame.</p>
        {hasGoal && (
          <button
            type="button"
            className="rally-quiet"
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              try {
                await onSave(null);
              } finally {
                setClearing(false);
              }
            }}
          >
            Remove goal
          </button>
        )}
      </div>

      {editing && <GoalDialog activity={activity} goals={goals} onSave={(g) => onSave(g)} mark={mark} onClose={() => setEditing(false)} />}
    </section>
  );
}

type Scene = "film" | "guide" | "hours" | "days" | "saved";
const daysOfWeek = [1, 2, 3, 4, 5, 6, 7];
const hourPresets: { value: number; note: string }[] = [
  { value: 1, note: "Easy start" },
  { value: 2, note: "Regular" },
  { value: 2.5, note: "The guideline" },
  { value: 3, note: "All in" },
];
const presetValues = hourPresets.map((p) => p.value);

function GoalDialog({
  activity,
  goals,
  onSave,
  mark,
  onClose,
}: {
  activity: RallyActivity;
  goals: RallyGoals;
  onSave: (goals: { days: number; hours: number }) => Promise<void>;
  mark?: ReactNode;
  onClose: () => void;
}) {
  const editing = goals.hours !== undefined && goals.days !== undefined;
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const ballStage = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const transition = useRef<number | undefined>(undefined);
  const [committed, setCommitted] = useState(false);
  const [changing, setChanging] = useState(false);
  // The intro film plays the first time only; editing a goal goes straight to the hours.
  const [scene, setScene] = useState<Scene>(editing ? "hours" : "film");
  const [revealed, setRevealed] = useState(false);
  const [arrival, setArrival] = useState<CSSProperties>();
  const [hours, setHours] = useState(goals.hours ?? 2);
  const [hourChoice, setHourChoice] = useState<number | "custom" | undefined>(
    goals.hours === undefined ? undefined : presetValues.includes(goals.hours) ? goals.hours : "custom",
  );
  const [customHours, setCustomHours] = useState(hourChoice === "custom" ? String(goals.hours) : "");
  const [days, setDays] = useState(goals.days);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const reveal = useCallback((handoff?: BallHandoff) => {
    const screen = dialog.current?.getBoundingClientRect();
    const stage = ballStage.current?.getBoundingClientRect();
    if (handoff && screen && stage?.width) {
      setArrival({
        "--rally-arrival-x": `${screen.x + handoff.x * screen.width - stage.x - stage.width / 2}px`,
        "--rally-arrival-y": `${screen.y + handoff.y * screen.height - stage.y - stage.height / 2}px`,
        "--rally-arrival-scale": handoff.diameter / stage.width,
        "--rally-tangent-x": `${handoff.vx * 107}px`,
        "--rally-tangent-y": `${handoff.vy * 107}px`,
      } as CSSProperties);
    }
    setRevealed(true);
  }, []);
  const brandMark = mark ?? <PingPodMark />;

  const count = activity.playedDays?.filter(Boolean).length;
  const target = Math.round(hours * 60);
  const perDay = days === undefined ? null : Math.ceil(target / days);
  const pace = count && activity.tableMinutes ? activity.tableMinutes / count : null;
  const step = scene === "hours" ? 1 : scene === "days" ? 2 : scene === "saved" ? 3 : 0;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    document.body.classList.add("no-scroll");
    return () => {
      window.clearTimeout(transition.current);
      document.body.classList.remove("no-scroll");
      element.close();
    };
  }, []);

  useEffect(() => {
    if (scene !== "film") {
      if (dialog.current) dialog.current.scrollTop = 0;
      title.current?.focus({ preventScroll: true });
    }
  }, [scene]);

  function advance(next: Scene, fromHours = false) {
    if (transition.current !== undefined) return;
    if (reduced) {
      setScene(next);
      return;
    }
    if (fromHours) setCommitted(true);
    setChanging(true);
    transition.current = window.setTimeout(
      () => {
        transition.current = undefined;
        setScene(next);
        setCommitted(false);
        setChanging(false);
      },
      fromHours ? 490 : 170,
    );
  }

  function submitHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changing) return;
    const value = typeof hourChoice === "number" ? hourChoice : Number(customHours);
    if (!(value >= 0.25 && value <= 168)) return;
    setHours(value);
    setDays((prev) => (prev !== undefined && prev >= Math.ceil(value / 24) ? prev : undefined));
    setError("");
    advance("days", true);
  }

  async function save() {
    if (days === undefined || saving || changing) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ days, hours });
      advance("saved");
    } catch {
      setError("Couldn't save your goal. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // How this week's pace compares with the plan (only when there's play to compare).
  let paceLine: ReactNode = null;
  if (pace !== null && days !== undefined && perDay !== null) {
    const avg = Math.round(pace);
    paceLine =
      avg >= perDay ? (
        <p className="rally-pace">
          This week you're averaging <strong>{duration(avg)}</strong> a visit. You're on pace.
        </p>
      ) : (
        <p className="rally-pace">
          This week you're averaging <strong>{duration(avg)}</strong> a visit. Stay about {duration(perDay - avg)} longer, or add a day.
        </p>
      );
  }

  return (
    <dialog
      ref={dialog}
      className="rally-dialog"
      data-intro={scene === "film"}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="rally-flow">
        <div className="rally-flow-top">
          <span className="rally-flow-brand">
            {brandMark} <span>Weekly goal</span>
          </span>
          {step > 0 && step < 3 && <span className="rally-step">Step {step} of 2</span>}
          <button type="button" className="rally-close" aria-label="Close" disabled={saving} onClick={onClose}>
            ×
          </button>
        </div>
        {scene !== "film" && (
          <div className="rally-seam" aria-hidden="true" data-scene={scene}>
            <span />
          </div>
        )}
        <div className="rally-scenes" data-changing={changing} data-committed={committed} inert={changing}>
          {scene === "film" && (
            // Tap anywhere to skip straight to the logo.
            <div className="rally-intro" data-revealed={revealed} data-bounce={Boolean(arrival)} onClick={() => !revealed && reveal()}>
              <div className="rally-screen" aria-hidden="true">
                {!revealed || arrival ? <RallyFilm onFinish={reveal} /> : null}
              </div>
              <div className="rally-lockup">
                <div className="rally-ball-stage" ref={ballStage} aria-hidden="true">
                  <div className="rally-ball-rim" />
                  <div className="rally-brand-ball" style={arrival}>
                    <div className="rally-ball-ink">{brandMark}</div>
                  </div>
                </div>
                <h2 id={titleId} className="rally-lockup-title">
                  Set goals
                </h2>
              </div>
              <div className="rally-intro-copy" inert={!revealed}>
                <button type="button" className="rally-primary" onClick={() => advance("guide")}>
                  Let's go <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          )}
          {scene === "guide" && (
            <section className="rally-scene rally-scene-activity">
              <p className="rally-eyebrow">A good place to start</p>
              <h2 className="rally-stat" id={titleId} ref={title} tabIndex={-1}>
                <span className="rally-stat-number">150</span>
                <span className="rally-stat-unit">minutes a week</span>
              </h2>
              <p className="rally-stat-source">
                The{" "}
                <a href="https://www.cdc.gov/physical-activity-basics/guidelines/adults.html" target="_blank" rel="noreferrer">
                  CDC's
                </a>{" "}
                weekly activity goal. Table tennis counts.
              </p>
              <div className="rally-activity-example">
                <TimeSplit sections={5} activityExample />
                <p>
                  Like <strong>30 minutes, 5 days a week.</strong>
                </p>
              </div>
              <button type="button" className="rally-primary" onClick={() => advance("hours")}>
                Pick my goal <span aria-hidden="true">→</span>
              </button>
            </section>
          )}
          {scene === "hours" && (
            <section className="rally-scene rally-scene-hours" data-committed={committed}>
              {activity.tableMinutes !== undefined && (
                <p className="rally-personal">
                  So far this week: <strong>{duration(activity.tableMinutes)}</strong>
                </p>
              )}
              <h2 id={titleId} ref={title} tabIndex={-1}>
                How much do you want to play each week?
              </h2>
              <form className="rally-hour-form" onSubmit={submitHours}>
                <fieldset className="rally-hours" disabled={committed}>
                  <legend className="rally-sr">Hours per week</legend>
                  {hourPresets.map(({ value, note }) => (
                    <label key={value} data-committed={committed && hourChoice === value}>
                      <input
                        type="radio"
                        name="rally-hours"
                        checked={hourChoice === value}
                        onChange={() => {
                          setHourChoice(value);
                          setCustomHours("");
                        }}
                      />
                      <span>
                        <strong>{hoursLabel(value)}</strong>
                        <span>{note}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <label className="rally-custom" data-selected={committed && hourChoice === "custom"}>
                  <span className="rally-sr">Other amount, in hours</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    required={hourChoice === "custom"}
                    step=".25"
                    min=".25"
                    max="168"
                    placeholder="Other amount (hours)"
                    disabled={committed}
                    value={customHours}
                    onChange={(event) => {
                      setCustomHours(event.target.value);
                      setHourChoice("custom");
                    }}
                  />
                </label>
                <button
                  className="rally-primary"
                  type="submit"
                  disabled={committed || hourChoice === undefined || (hourChoice === "custom" && !customHours)}
                >
                  Next: pick your days <span aria-hidden="true">→</span>
                </button>
              </form>
              {!editing && (
                <button className="rally-quiet" type="button" onClick={() => advance("guide")}>
                  Back
                </button>
              )}
            </section>
          )}
          {scene === "days" && (
            <section className="rally-scene">
              <p className="rally-personal">
                Your goal: <strong>{hoursLabel(hours)}</strong> a week
              </p>
              <h2 id={titleId} ref={title} tabIndex={-1}>
                How many days will you play?
              </h2>
              <fieldset className="rally-days" disabled={saving}>
                <legend className="rally-sr">Play days per week</legend>
                {daysOfWeek.map((value) => (
                  <label key={value}>
                    <input type="radio" name="rally-days" checked={days === value} disabled={target > value * 1440} onChange={() => setDays(value)} />
                    <span>
                      {value}
                      <span className="rally-sr"> {value === 1 ? "day" : "days"}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="rally-plan" aria-live="polite">
                {days === undefined || perDay === null ? (
                  <p>Pick a number of days to see how long each visit should be.</p>
                ) : (
                  <>
                    <TimeSplit sections={days} />
                    <div className="rally-plan-label">Each play day, aim for about</div>
                    <strong key={perDay}>{duration(perDay)}</strong>
                    <p className="rally-math num">
                      {days} {days === 1 ? "day" : "days"} × {duration(perDay)} = {hoursLabel(hours)} a week
                    </p>
                    {paceLine}
                  </>
                )}
              </div>
              {error && <p role="alert">{error}</p>}
              <button className="rally-primary" type="button" disabled={saving || days === undefined} onClick={() => void save()}>
                {saving ? "Saving…" : "Save my goal"}
              </button>
              <button className="rally-quiet" type="button" disabled={saving} onClick={() => advance("hours")}>
                Back
              </button>
            </section>
          )}
          {scene === "saved" && (
            <section className="rally-scene rally-scene-saved">
              <div className="rally-saved-mark" aria-hidden="true">
                <Flame size={26} />
              </div>
              <h2 id={titleId} ref={title} tabIndex={-1}>
                You're set.
              </h2>
              <p>
                <strong>{hoursLabel(hours)}</strong> over <strong>{days} {days === 1 ? "day" : "days"}</strong> a week. That's about{" "}
                <strong>{perDay !== null ? duration(perDay) : ""}</strong> each time you play.
              </p>
              <p className="rally-fine">Track it on Home. A new week starts Monday.</p>
              <button className="rally-primary" type="button" onClick={onClose}>
                Done
              </button>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}

function TimeSplit({ sections, activityExample = false }: { sections: number; activityExample?: boolean }) {
  return (
    <div className="rally-split" data-example={activityExample} aria-hidden="true">
      <span className="rally-split-fill" />
      {daysOfWeek.slice(0, -1).map((index, offset) => (
        <span
          className="rally-split-cut"
          key={index}
          data-active={index < sections}
          style={{ left: `${Math.min(100, (index / sections) * 100)}%`, transitionDelay: `${activityExample ? 0 : offset * 32}ms` }}
        />
      ))}
    </div>
  );
}

function PingPodMark() {
  return (
    <svg viewBox="18 88 204 64" width="38" height="12" aria-hidden="true">
      <circle cx="27.5" cy="97.5" r="7.5" fill="var(--pink, #ff0078)" />
      <path d="M55 90h124v32H55z M63 98v16h108V98z M55 122h62l-35 28H20z" fill="currentColor" fillRule="evenodd" />
      <path d="M179 90h41l-41 32z M117 122h62l-35 28H82z" fill="var(--pink, #ff0078)" />
    </svg>
  );
}
