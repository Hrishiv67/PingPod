import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Button, Field, InlineError, Sheet } from "../components/ui";
import { errorText } from "../lib/api";

/** Load data with loading/error state; `reload` re-runs the loader. Stale responses are ignored. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const next = await load();
      if (n === seq.current) setData(next);
    } catch (err) {
      if (n === seq.current) setError(errorText(err));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

/** Value that only updates after the user stops typing. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="adm-search">
      <Search size={18} aria-hidden />
      <span className="sr-only">{placeholder}</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Horizontally scrollable filter chips (fits 5+ options on a phone). */
export function FilterChips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="adm-filters" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count ? <span className="adm-filter-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SectionHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="adm-section-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="adm-section-actions">{actions}</div>}
    </div>
  );
}

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "pink" | "warn" }) {
  return <div className={`adm-note adm-note-${tone}`}>{children}</div>;
}

export function OwnerOnly({ children = "Only an owner can change this." }: { children?: ReactNode }) {
  return <p className="adm-owner-only">{children}</p>;
}

/** A sheet that collects an optional minutes value and/or a reason, then runs the action. */
export function ActionSheet({
  title,
  description,
  confirmLabel,
  danger = false,
  minutes,
  text,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  minutes?: { initial: number; label: string; min: number; max: number };
  text?: { label: string; required: boolean; placeholder?: string; hint?: string; initial?: string; maxLength?: number };
  onSubmit: (minutes: number | null, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [mins, setMins] = useState(minutes ? String(minutes.initial) : "");
  const [value, setValue] = useState(text?.initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsed = minutes ? Number.parseInt(mins, 10) : null;
  const minutesInvalid =
    minutes != null && (parsed == null || Number.isNaN(parsed) || parsed < minutes.min || parsed > minutes.max);
  const textMissing = Boolean(text?.required) && value.trim().length === 0;
  return (
    <Sheet title={title} onClose={onClose}>
      {description && <div className="sheet-text">{description}</div>}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (minutesInvalid || textMissing) return;
          setBusy(true);
          setError("");
          try {
            await onSubmit(minutes ? (parsed as number) : null, value.trim());
            onClose();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {minutes && (
          <Field
            label={minutes.label}
            type="number"
            inputMode="numeric"
            min={minutes.min}
            max={minutes.max}
            value={mins}
            onChange={(e) => setMins(e.target.value)}
            error={minutesInvalid && mins !== "" ? `Enter ${minutes.min}–${minutes.max} minutes.` : undefined}
          />
        )}
        {text && (
          <div className="field">
            <label htmlFor="adm-action-text">
              {text.label}
              {!text.required && <span className="adm-optional"> (optional)</span>}
            </label>
            <textarea
              id="adm-action-text"
              className="input"
              rows={3}
              maxLength={text.maxLength ?? 300}
              placeholder={text.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {text.hint && <div className="field-hint">{text.hint}</div>}
          </div>
        )}
        {error && <InlineError>{error}</InlineError>}
        <div className="stack-sm">
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            size="lg"
            block
            loading={busy}
            disabled={minutesInvalid || textMissing}
          >
            {confirmLabel}
          </Button>
          <Button type="button" variant="ghost" size="lg" block onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

export const FLAG_LABELS: Record<string, string> = {
  auto_closed: "Timer ran to the 3-hour limit",
  hit_max: "Hit max length",
  same_day_as_timer: "Also has a timer session that day",
  too_short: "Too short to count",
};

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag.replace(/_/g, " ");
}

// ── CSV export ────────────────────────────────────────────────────────
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralize spreadsheet formulas in text cells (CSV injection).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.map(csvCell).join(",")];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
