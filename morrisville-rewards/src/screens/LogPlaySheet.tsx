import { useMemo, useState } from "react";
import { api, errorText } from "../lib/api";
import { newRequestId } from "../lib/storage";
import { addDays, formatDay, venueDate } from "../lib/time";
import type { Settings } from "../lib/types";
import { Button, InlineError, Sheet } from "../components/ui";

const QUICK = [30, 60, 90, 120];

export default function LogPlaySheet({
  settings,
  onClose,
  onSaved,
}: {
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = venueDate();
  const minDay = addDays(today, -settings.backdate_days);
  const [day, setDay] = useState(today);
  const [minutes, setMinutes] = useState<number | null>(60);
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One id per open sheet: a double tap or a retry can't create two sessions.
  const requestId = useMemo(() => newRequestId(), []);

  const value = custom ? Number(customText) : minutes;
  const min = settings.manual_min_minutes;
  const max = settings.manual_max_minutes;
  const minutesProblem =
    value == null || !Number.isFinite(value) || !Number.isInteger(value)
      ? "Choose how long you played."
      : value < min || value > max
        ? `Enter between ${min} and ${max} minutes.`
        : "";
  const dayProblem = day > today ? "That date is in the future." : day < minDay ? `Pick a day in the last ${settings.backdate_days} days.` : "";

  async function save() {
    if (minutesProblem || dayProblem) return setError(minutesProblem || dayProblem);
    setBusy(true);
    setError("");
    try {
      await api.logSession({ played_on: day, minutes: value!, note: note.trim() || undefined, client_request_id: requestId });
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Log past play" onClose={onClose}>
      <div className="stack-sm">
        <span className="label">When did you play?</span>
        <div className="pick-row" role="radiogroup" aria-label="Day">
          {[today, addDays(today, -1)].map((d) => (
            <button key={d} type="button" role="radio" className="pick" aria-checked={day === d} onClick={() => setDay(d)}>
              {d === today ? "Today" : "Yesterday"}
            </button>
          ))}
        </div>
        <input
          className="input"
          type="date"
          aria-label="Or pick a date"
          min={minDay}
          max={today}
          value={day}
          onChange={(e) => setDay(e.target.value || today)}
        />
        <span className="small-print">
          {formatDay(day)} · up to {settings.backdate_days} days back
        </span>
      </div>

      <div className="stack-sm">
        <span className="label">How long?</span>
        <div className="pick-row" role="radiogroup" aria-label="Duration">
          {QUICK.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              className="pick"
              aria-checked={!custom && minutes === m}
              onClick={() => {
                setCustom(false);
                setMinutes(m);
              }}
            >
              {m}
            </button>
          ))}
          <button type="button" role="radio" className="pick" aria-checked={custom} onClick={() => setCustom(true)}>
            Other
          </button>
        </div>
        {custom && (
          <input
            className="input"
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            min={min}
            max={max}
            placeholder={`Minutes (${min}–${max})`}
            aria-label="Minutes played"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            autoFocus
          />
        )}
        <span className="small-print">Minutes of play</span>
      </div>

      <div className="stack-sm">
        <label className="label" htmlFor="log-note">
          Note <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea
          id="log-note"
          className="input"
          maxLength={280}
          rows={2}
          placeholder="e.g. Doubles with Sam, table 4"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <InlineError>{error}</InlineError>}
      <Button variant="primary" size="lg" block loading={busy} onClick={() => void save()}>
        Save session
      </Button>
      <p className="small-print">Self-reported · Pending verification. Staff check sessions before they count as verified.</p>
    </Sheet>
  );
}
