import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { RallyFilm, type BallHandoff } from "./RallyFilm";
import "./weekly-rally.css";

// Weekly Rally: this week at a glance on Home (a flame for each day you played, your minutes and
// rank), plus an optional weekly goal (hours and play days) set in a short full-screen planner.

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

/** "Goal hit" / "1 hr 15 min to go" / "2 days to go" / "45 min and 2 days to go". */
export function goalStatus(
  activity: RallyActivity,
  goals: RallyGoals,
): string | null {
  if (goals.days === undefined || goals.hours === undefined) return null;
  const daysLeft = Math.max(
    0,
    goals.days - (activity.playedDays?.filter(Boolean).length ?? 0),
  );
  const minutesLeft = Math.max(
    0,
    Math.round(goals.hours * 60) - (activity.tableMinutes ?? 0),
  );
  if (!daysLeft && !minutesLeft) return "Goal hit";
  if (!minutesLeft)
    return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`;
  if (!daysLeft) return `${duration(minutesLeft)} to go`;
  return `${duration(minutesLeft)} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`;
}

function Flame() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M13 2c1 4-.3 6.8-2.7 8.7.2-1.5-.2-2.6-1.2-3.5C7.2 9.5 5 12.1 5 15.4a7 7 0 0 0 14 0C19 10.7 15.8 6 13 2Z"
        fill="currentColor"
      />
      <path
        d="M12.9 13c.2 1.4-.3 2.3-1.3 3-.2-.5-.4-.8-.8-1.1-.8.9-1.2 1.8-1.2 2.7a2.6 2.6 0 0 0 5.2 0c0-1.5-.7-3-1.9-4.6Z"
        className="rally-flame-cutout"
      />
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
  /** Persist the goal; pass nulls (via `clear`) to remove it. Throw to show a retry message. */
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

  // A newly saved goal opens the card so the player sees it straight away.
  const previous = useRef({ days: goals.days, hours: goals.hours });
  useEffect(() => {
    if (
      previous.current.days !== goals.days ||
      previous.current.hours !== goals.hours
    ) {
      previous.current = { days: goals.days, hours: goals.hours };
      if (goals.days !== undefined) setExpanded(true);
    }
  }, [goals.days, goals.hours]);

  return (
    <section className="rally-card" aria-label="Weekly Rally">
      <button
        className="rally-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((o) => !o)}
      >
        <span className="rally-head">
          <span className="rally-title">Weekly Rally</span>
          <span className="rally-sub">{duration(minutes)} this week</span>
        </span>
        {rank ? <span className="rally-rank num">#{rank}</span> : null}
        <span className="rally-chevron" aria-hidden="true" />
      </button>

      <ol className="rally-week" aria-label="Play days this week">
        {weekdays.map((day, index) => {
          const on = activity.playedDays?.[index];
          return (
            <li
              key={day}
              className={`${on ? "rally-played" : ""} ${index === today ? "rally-today" : ""}`}
            >
              <Flame />
              <span>
                {day}
                <span className="rally-sr">
                  {" "}
                  {on
                    ? "played"
                    : index > today
                      ? "coming up"
                      : "no play logged"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {hasGoal ? (
        <div className="rally-goal" aria-label="Weekly goal progress">
          <span className="rally-bar" aria-hidden="true">
            <span style={{ width: `${timePct}%` }} />
          </span>
          <span className="rally-goal-line">
            <span className="num">
              {played}/{goals.days} days · {duration(minutes)} /{" "}
              {duration(goalMinutes)}
            </span>
            <strong>{status}</strong>
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="rally-set"
          onClick={() => setEditing(true)}
        >
          Set a weekly goal <span aria-hidden="true">→</span>
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
            <dd className="num">
              {played ? duration(Math.round(minutes / played)) : "—"}
            </dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd className="num">
              {streak} {streak === 1 ? "day" : "days"}
            </dd>
          </div>
        </dl>
        {hasGoal && (
          <div className="rally-actions">
            <button
              type="button"
              className="rally-edit"
              onClick={() => setEditing(true)}
            >
              Edit weekly goal
            </button>
            {
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
            }
          </div>
        )}
      </div>

      {editing && (
        <GoalDialog
          activity={activity}
          goals={goals}
          onSave={(g) => onSave(g)}
          mark={mark}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

type Scene = "film" | "activity" | "hours" | "days" | "saved";
const daysOfWeek = [1, 2, 3, 4, 5, 6, 7];
const hourPresets = [1, 2, 3];

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
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const ballStage = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const transition = useRef<number | undefined>(undefined);
  const [committed, setCommitted] = useState(false);
  const [changing, setChanging] = useState(false);
  const [scene, setScene] = useState<Scene>("film");
  const [revealed, setRevealed] = useState(false);
  const [arrival, setArrival] = useState<CSSProperties>();
  const [hours, setHours] = useState(goals.hours ?? 2);
  const [hourChoice, setHourChoice] = useState<number | "custom" | undefined>(
    goals.hours === undefined || hourPresets.includes(goals.hours)
      ? goals.hours
      : "custom",
  );
  const [customHours, setCustomHours] = useState(
    hourChoice === "custom" ? String(goals.hours) : "",
  );
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
  const pace =
    count && activity.tableMinutes ? activity.tableMinutes / count : null;
  const difference =
    pace === null || days === undefined
      ? null
      : Math.round(pace * days - target);
  const editing = goals.hours !== undefined || goals.days !== undefined;

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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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

  function selectHours(value: number) {
    if (changing) return;
    setHours(value);
    setDays((prev) =>
      prev !== undefined && prev >= Math.ceil(value / 24) ? prev : undefined,
    );
    setError("");
    advance("days", true);
  }

  function submitHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value =
      typeof hourChoice === "number" ? hourChoice : Number(customHours);
    if (value >= 0.25 && value <= 168) selectHours(value);
  }

  async function save() {
    if (days === undefined || saving || changing) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ days, hours });
      advance("saved");
    } catch {
      setError("Couldn't save your plan. Try again.");
    } finally {
      setSaving(false);
    }
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
            {brandMark} <span>Weekly Rally</span>
          </span>
          <button
            type="button"
            className="rally-close"
            aria-label="Close goal setup"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {scene !== "film" && (
          <div className="rally-seam" aria-hidden="true" data-scene={scene}>
            <span />
          </div>
        )}
        <div
          className="rally-scenes"
          data-changing={changing}
          data-committed={committed}
          inert={changing}
        >
          {scene === "film" && (
            <div
              className="rally-intro"
              data-revealed={revealed}
              data-bounce={Boolean(arrival)}
            >
              <div className="rally-screen" aria-hidden="true">
                <RallyFilm onFinish={reveal} />
              </div>
              <div className="rally-lockup">
                <div
                  className="rally-ball-stage"
                  ref={ballStage}
                  aria-hidden="true"
                >
                  <div className="rally-ball-rim" />
                  <div className="rally-brand-ball" style={arrival}>
                    <div className="rally-ball-ink">{brandMark}</div>
                  </div>
                </div>
                <h2 id={titleId} className="rally-lockup-title">
                  PingPod Goals
                </h2>
              </div>
              <div className="rally-intro-copy" inert={!revealed}>
                <button
                  type="button"
                  className="rally-primary"
                  onClick={() => advance(editing ? "hours" : "activity")}
                >
                  Continue <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          )}
          {scene === "activity" && (
            <section className="rally-scene rally-scene-activity">
              <h2 className="rally-stat" id={titleId} ref={title} tabIndex={-1}>
                <span className="rally-stat-number">150</span>
                <span className="rally-stat-unit">min / week</span>
              </h2>
              <p className="rally-stat-source">
                The{" "}
                <a
                  href="https://www.cdc.gov/physical-activity-basics/guidelines/adults.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  CDC
                </a>{" "}
                recommends at least this much moderate activity a week for
                adults.
              </p>
              <div className="rally-activity-example">
                <TimeSplit sections={5} activityExample />
                <p>
                  For example, <strong>30 minutes on 5 days.</strong>
                </p>
              </div>
              <button
                type="button"
                className="rally-primary"
                onClick={() => advance("hours")}
              >
                Set my weekly goal <span aria-hidden="true">→</span>
              </button>
            </section>
          )}
          {scene === "hours" && (
            <section
              className="rally-scene rally-scene-hours"
              data-committed={committed}
            >
              {activity.tableMinutes !== undefined && (
                <p className="rally-personal">
                  <strong>{duration(activity.tableMinutes)}</strong> played this
                  week
                </p>
              )}
              <h2 id={titleId} ref={title} tabIndex={-1}>
                How many hours do you want to play each week?
              </h2>
              <form className="rally-hour-form" onSubmit={submitHours}>
                <fieldset className="rally-hours" disabled={committed}>
                  <legend className="rally-sr">Hours per week</legend>
                  {hourPresets.map((value) => (
                    <label
                      key={value}
                      data-committed={committed && hourChoice === value}
                    >
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
                        <strong>{value}</strong>
                        <span>{value === 1 ? "hour" : "hours"}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <label
                  className="rally-custom"
                  data-selected={committed && hourChoice === "custom"}
                >
                  <span className="rally-sr">Custom weekly hours</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    required={hourChoice === "custom"}
                    step=".25"
                    min=".25"
                    max="168"
                    placeholder="Custom hours"
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
                  disabled={
                    committed ||
                    hourChoice === undefined ||
                    (hourChoice === "custom" && !customHours)
                  }
                >
                  Continue to play days <span aria-hidden="true">→</span>
                </button>
              </form>
            </section>
          )}
          {scene === "days" && (
            <section className="rally-scene">
              <p className="rally-personal">
                <strong>{duration(target)}</strong> weekly target
              </p>
              <h2 id={titleId} ref={title} tabIndex={-1}>
                How many days will you play each week?
              </h2>
              <fieldset className="rally-days" disabled={saving}>
                <legend className="rally-sr">Play days per week</legend>
                {daysOfWeek.map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="rally-days"
                      checked={days === value}
                      disabled={target > value * 1440}
                      onChange={() => setDays(value)}
                    />
                    <span>
                      {value}
                      <span className="rally-sr">
                        {" "}
                        {value === 1 ? "day" : "days"}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="rally-plan" aria-live="polite">
                {days === undefined || perDay === null ? (
                  <p>
                    Pick a day count to see how much time to aim for each day.
                  </p>
                ) : (
                  <>
                    <TimeSplit sections={days} />
                    <div className="rally-plan-label">
                      To reach your time goal, aim for
                    </div>
                    <strong key={perDay}>{duration(perDay)}</strong>
                    <span>per play day</span>
                    {pace !== null && difference !== null && (
                      <p>
                        You averaged about{" "}
                        <strong>
                          {duration(Math.round(pace))} per play day
                        </strong>{" "}
                        this week. At that pace, {days}{" "}
                        {days === 1 ? "day" : "days"}{" "}
                        {difference === 0
                          ? "would hit"
                          : `would put you about ${duration(Math.abs(difference))} ${difference > 0 ? "over" : "short of"}`}{" "}
                        your weekly time goal.
                      </p>
                    )}
                  </>
                )}
              </div>
              {error && <p role="alert">{error}</p>}
              <button
                className="rally-primary"
                type="button"
                disabled={saving || days === undefined}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save weekly plan"}
              </button>
              <button
                className="rally-quiet"
                type="button"
                disabled={saving}
                onClick={() => advance("hours")}
              >
                Back to hours
              </button>
            </section>
          )}
          {scene === "saved" && (
            <section className="rally-scene rally-scene-saved">
              <div className="rally-saved-mark" aria-hidden="true">
                <Flame />
              </div>
              <h2 id={titleId} ref={title} tabIndex={-1}>
                Plan set.
              </h2>
              <p>
                <strong>{duration(target)}</strong> across{" "}
                <strong>
                  {days} {days === 1 ? "day" : "days"}
                </strong>{" "}
                each week.
              </p>
              <button className="rally-primary" type="button" onClick={onClose}>
                Back to Home
              </button>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}

function TimeSplit({
  sections,
  activityExample = false,
}: {
  sections: number;
  activityExample?: boolean;
}) {
  return (
    <div
      className="rally-split"
      data-example={activityExample}
      aria-hidden="true"
    >
      <span className="rally-split-fill" />
      {daysOfWeek.slice(0, -1).map((index, offset) => (
        <span
          className="rally-split-cut"
          key={index}
          data-active={index < sections}
          style={{
            left: `${Math.min(100, (index / sections) * 100)}%`,
            transitionDelay: `${activityExample ? 0 : offset * 32}ms`,
          }}
        />
      ))}
    </div>
  );
}

function PingPodMark() {
  return (
    <svg viewBox="18 88 204 64" width="38" height="12" aria-hidden="true">
      <circle cx="27.5" cy="97.5" r="7.5" fill="var(--pink, #ff0078)" />
      <path
        d="M55 90h124v32H55z M63 98v16h108V98z M55 122h62l-35 28H20z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        d="M179 90h41l-41 32z M117 122h62l-35 28H82z"
        fill="var(--pink, #ff0078)"
      />
    </svg>
  );
}
