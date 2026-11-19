import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorText } from "../lib/api";
import type { BoardKey, DisplaySlide, Scope, Settings } from "../lib/types";
import { Button, InlineError, Skeleton, Toggle, useToast } from "../components/ui";
import { formatDateTime } from "../lib/time";
import { Note, OwnerOnly, SectionHead } from "./shared";

type NumKey =
  | "max_session_minutes"
  | "checkin_reminder_minutes"
  | "manual_min_minutes"
  | "manual_max_minutes"
  | "backdate_days"
  | "daily_minutes_cap"
  | "crew_min_size"
  | "crew_max_size"
  | "display_rotation_seconds";

const NUM_FIELDS: Record<NumKey, { label: string; unit: string; min: number; max: number; hint?: string }> = {
  max_session_minutes: { label: "Stop timers after", unit: "min", min: 30, max: 480, hint: "A timer left running stops here and gets flagged." },
  checkin_reminder_minutes: { label: "Ask “Still playing?” after", unit: "min", min: 15, max: 240 },
  manual_min_minutes: { label: "Shortest session that counts", unit: "min", min: 1, max: 60 },
  manual_max_minutes: { label: "Longest session players can log", unit: "min", min: 15, max: 480 },
  backdate_days: { label: "How far back players can log", unit: "days", min: 0, max: 60 },
  daily_minutes_cap: { label: "Most minutes per player per day", unit: "min", min: 30, max: 720 },
  crew_min_size: { label: "Members needed to show on the board", unit: "players", min: 1, max: 10 },
  crew_max_size: { label: "Largest crew", unit: "players", min: 2, max: 30 },
  display_rotation_seconds: { label: "Seconds per screen", unit: "sec", min: 8, max: 60 },
};

const SLIDES: { value: DisplaySlide; label: string }[] = [
  { value: "minutes", label: "Most minutes this week" },
  { value: "streaks", label: "Longest streaks" },
  { value: "crews", label: "Top crews" },
  { value: "highlights", label: "This week's highlights" },
  { value: "longest", label: "Longest session this week" },
];

const BOARDS: { value: BoardKey; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "streaks", label: "Streaks" },
  { value: "longest", label: "Longest session" },
  { value: "spindex", label: "SPINDEX" },
  { value: "crews", label: "Crews" },
];

type Draft = {
  venue_name: string;
  public_app_url: string;
  pilot_start: string;
  pilot_end: string;
  auto_approve_timer: boolean;
  default_board_scope: Scope;
  display_scope: Scope;
  display_slides: DisplaySlide[];
  boards_enabled: BoardKey[];
  rewards_enabled: boolean;
} & Record<NumKey, string>;

function toDraft(s: Settings): Draft {
  const nums = Object.fromEntries(Object.keys(NUM_FIELDS).map((k) => [k, String(s[k as NumKey])])) as Record<NumKey, string>;
  return {
    ...nums,
    venue_name: s.venue_name,
    public_app_url: s.public_app_url,
    pilot_start: s.pilot_start ?? "",
    pilot_end: s.pilot_end ?? "",
    auto_approve_timer: s.auto_approve_timer,
    default_board_scope: s.default_board_scope,
    display_scope: s.display_scope,
    display_slides: [...s.display_slides],
    boards_enabled: [...s.boards_enabled],
    rewards_enabled: s.rewards_enabled,
  };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export default function SettingsTab({
  isOwner,
  fallback,
  onSaved,
}: {
  isOwner: boolean;
  fallback: Settings;
  onSaved: () => Promise<void> | void;
}) {
  const [base, setBase] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  async function load() {
    setLoadError("");
    try {
      const s = await api.publicSettings();
      setBase(s);
      setDraft(toDraft(s));
    } catch (err) {
      setLoadError(errorText(err));
      setBase(fallback);
      setDraft(toDraft(fallback));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = useMemo(() => {
    if (!base || !draft) return {} as Partial<Settings>;
    const p: Record<string, unknown> = {};
    for (const k of Object.keys(NUM_FIELDS) as NumKey[]) {
      const n = Number.parseInt(draft[k], 10);
      if (draft[k].trim() !== "" && n !== base[k]) p[k] = n;
    }
    if (draft.venue_name.trim() && draft.venue_name.trim() !== base.venue_name) p.venue_name = draft.venue_name.trim();
    if (draft.public_app_url.trim() && draft.public_app_url.trim() !== base.public_app_url) p.public_app_url = draft.public_app_url.trim().replace(/\/+$/, "");
    if (draft.pilot_start !== (base.pilot_start ?? "")) p.pilot_start = draft.pilot_start;
    if (draft.pilot_end !== (base.pilot_end ?? "")) p.pilot_end = draft.pilot_end;
    for (const k of ["auto_approve_timer", "rewards_enabled", "default_board_scope", "display_scope"] as const) {
      if (draft[k] !== base[k]) p[k] = draft[k];
    }
    if (!sameList(draft.display_slides, base.display_slides)) p.display_slides = draft.display_slides;
    if (!sameList(draft.boards_enabled, base.boards_enabled)) p.boards_enabled = draft.boards_enabled;
    return p as Partial<Settings>;
  }, [base, draft]);

  const changed = Object.keys(patch).length;
  const numErrors = draft
    ? (Object.keys(NUM_FIELDS) as NumKey[]).filter((k) => {
        const n = Number(draft[k]);
        return !Number.isInteger(n) || n < NUM_FIELDS[k].min || n > NUM_FIELDS[k].max;
      })
    : [];

  if (!draft || !base) return <section className="adm-section"><SectionHead title="Settings" /><Skeleton height={64} count={6} /></section>;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const toggleIn = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const disabled = !isOwner || saving;

  const num = (k: NumKey) => {
    const f = NUM_FIELDS[k];
    const bad = numErrors.includes(k);
    return (
      <div className="field adm-num-field" key={k}>
        <label htmlFor={`set-${k}`}>{f.label}</label>
        <div className="adm-unit-input">
          <input
            id={`set-${k}`}
            className="input"
            type="number"
            inputMode="numeric"
            min={f.min}
            max={f.max}
            value={draft[k]}
            disabled={disabled}
            aria-invalid={bad || undefined}
            onChange={(e) => set(k, e.target.value)}
          />
          <span>{f.unit}</span>
        </div>
        <div className={bad ? "field-error" : "field-hint"}>{bad ? `Use ${f.min}–${f.max}.` : f.hint}</div>
      </div>
    );
  };

  return (
    <section className="adm-section adm-settings">
      <SectionHead title="Settings" sub={base.updated_at ? `Last saved ${formatDateTime(base.updated_at)}` : undefined} />
      {!isOwner && <OwnerOnly>Only an owner can change settings.</OwnerOnly>}
      {loadError && <InlineError onRetry={() => void load()}>{loadError}</InlineError>}

      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!changed || numErrors.length) return;
          setSaving(true);
          setError("");
          try {
            const next = await api.admin.updateSettings(patch);
            setBase(next);
            setDraft(toDraft(next));
            toast("Settings saved");
            await onSaved();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Group title="Pilot dates">
          <div className="adm-two">
            <div className="field">
              <label htmlFor="set-start">Starts</label>
              <input id="set-start" className="input" type="date" value={draft.pilot_start} disabled={disabled} onChange={(e) => set("pilot_start", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="set-end">Ends</label>
              <input id="set-end" className="input" type="date" value={draft.pilot_end} disabled={disabled} onChange={(e) => set("pilot_end", e.target.value)} />
            </div>
          </div>
        </Group>

        <Group title="Timers">
          <div className="adm-grid-fields">
            {num("max_session_minutes")}
            {num("checkin_reminder_minutes")}
          </div>
        </Group>

        <Group title="Logging past sessions">
          <div className="adm-grid-fields">
            {num("backdate_days")}
            {num("manual_max_minutes")}
          </div>
        </Group>

        <Group title="Crews">
          <div className="adm-grid-fields">
            {num("crew_max_size")}
            {num("crew_min_size")}
          </div>
        </Group>

        <Group title="iPad display">
          {num("display_rotation_seconds")}
          <fieldset className="adm-checks" disabled={disabled}>
            <legend className="label">Screens to show</legend>
            {SLIDES.map((s) => (
              <label key={s.value} className="adm-check">
                <input
                  type="checkbox"
                  checked={draft.display_slides.includes(s.value)}
                  onChange={() => {
                    const next = toggleIn(draft.display_slides, s.value);
                    if (next.length) set("display_slides", next);
                  }}
                />
                {s.label}
              </label>
            ))}
          </fieldset>
          <p className="field-hint">Screens with no results yet are skipped automatically. Don't sign in on the front-desk iPad.</p>
        </Group>

        <Group title="Rewards">
          <Toggle
            checked={draft.rewards_enabled}
            disabled={disabled}
            onChange={(v) => set("rewards_enabled", v)}
            label="Show rewards to players"
            description="Players only see rewards you've also turned on under More → Rewards."
          />
          {draft.rewards_enabled && !base.rewards_enabled && (
            <Note tone="warn">Only turn this on after Joe has approved the prizes and how they're handed out.</Note>
          )}
        </Group>

        <details className="adm-advanced">
          <summary>Advanced</summary>
          <div className="stack">
            <div className="field">
              <label htmlFor="set-url">App address for QR codes</label>
              <input
                id="set-url"
                className="input"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                value={draft.public_app_url}
                disabled={disabled}
                onChange={(e) => set("public_app_url", e.target.value)}
              />
              <div className="field-hint">Reprint the poster if you change this.</div>
            </div>
            <div className="field">
              <label htmlFor="set-venue">Venue name</label>
              <input id="set-venue" className="input" value={draft.venue_name} disabled={disabled} onChange={(e) => set("venue_name", e.target.value)} />
            </div>
            <div className="adm-grid-fields">
              {num("manual_min_minutes")}
              {num("daily_minutes_cap")}
            </div>
            <fieldset className="adm-checks" disabled={disabled}>
              <legend className="label">Leaderboards players can see</legend>
              {BOARDS.map((b) => (
                <label key={b.value} className="adm-check">
                  <input type="checkbox" checked={draft.boards_enabled.includes(b.value)} onChange={() => set("boards_enabled", toggleIn(draft.boards_enabled, b.value))} />
                  {b.label}
                </label>
              ))}
            </fieldset>
          </div>
        </details>

        {error && <InlineError>{error}</InlineError>}
        {isOwner && changed > 0 && (
          <div className="adm-savebar on" role="region" aria-label="Unsaved changes">
            <span>{`${changed} unsaved change${changed === 1 ? "" : "s"}`}</span>
            <div className="adm-actions">
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(toDraft(base))}>
                Discard
              </Button>
              <Button type="submit" variant="primary" loading={saving} disabled={numErrors.length > 0}>
                Save
              </Button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="adm-group">
      <legend>{title}</legend>
      <div className="stack">{children}</div>
    </fieldset>
  );
}

