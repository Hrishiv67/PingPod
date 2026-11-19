import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorText } from "../lib/api";
import type { BoardKey, DisplaySlide, Scope, Settings } from "../lib/types";
import { Button, InlineError, Segmented, Skeleton, Toggle, useToast } from "../components/ui";
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
  max_session_minutes: { label: "Max session length", unit: "min", min: 30, max: 480, hint: "Timers stop and get flagged after this." },
  checkin_reminder_minutes: { label: "Check-in reminder", unit: "min", min: 15, max: 240, hint: "When the player's phone asks “Still playing?”" },
  manual_min_minutes: { label: "Shortest session", unit: "min", min: 1, max: 60, hint: "Minimum for logged play, and the shortest timer that counts." },
  manual_max_minutes: { label: "Longest logged session", unit: "min", min: 15, max: 480 },
  backdate_days: { label: "Backdating", unit: "days", min: 0, max: 60, hint: "How far back players can log play." },
  daily_minutes_cap: { label: "Daily cap", unit: "min", min: 30, max: 720, hint: "Most minutes one player can record on one day." },
  crew_min_size: { label: "Crew minimum", unit: "players", min: 1, max: 10, hint: "Crews need this many members to appear on the board." },
  crew_max_size: { label: "Crew maximum", unit: "players", min: 2, max: 30 },
  display_rotation_seconds: { label: "Display rotation", unit: "sec", min: 8, max: 60, hint: "Time each iPad screen stays up." },
};

const SLIDES: { value: DisplaySlide; label: string }[] = [
  { value: "minutes", label: "Most minutes this week" },
  { value: "streaks", label: "Longest current streaks" },
  { value: "crews", label: "Top crews" },
  { value: "highlights", label: "Weekly highlights" },
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
      <SectionHead title="Settings" sub={base.updated_at ? `Last changed ${formatDateTime(base.updated_at)}` : undefined} />
      {!isOwner && <OwnerOnly>Only an owner can change settings. You can see the current values below.</OwnerOnly>}
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
        <Group title="Pilot">
          <div className="field">
            <label htmlFor="set-venue">Venue name</label>
            <input id="set-venue" className="input" value={draft.venue_name} disabled={disabled} onChange={(e) => set("venue_name", e.target.value)} />
          </div>
          <div className="adm-two">
            <div className="field">
              <label htmlFor="set-start">Pilot start</label>
              <input id="set-start" className="input" type="date" value={draft.pilot_start} disabled={disabled} onChange={(e) => set("pilot_start", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="set-end">Pilot end</label>
              <input id="set-end" className="input" type="date" value={draft.pilot_end} disabled={disabled} onChange={(e) => set("pilot_end", e.target.value)} />
            </div>
          </div>
          <p className="field-hint">Used for analytics and exports.</p>
          <div className="field">
            <label htmlFor="set-url">Public app address</label>
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
            <div className="field-hint">Every QR code (iPad board and printed poster) points here. Reprint the poster if you change it.</div>
          </div>
        </Group>

        <Group title="Playing sessions">
          <div className="adm-grid-fields">
            {num("max_session_minutes")}
            {num("checkin_reminder_minutes")}
          </div>
          <Toggle
            checked={draft.auto_approve_timer}
            disabled={disabled}
            onChange={(v) => set("auto_approve_timer", v)}
            label="Auto-approve timer sessions"
            description="Live-timer sessions skip review. Logged sessions are always reviewed."
          />
        </Group>

        <Group title="Logging past play">
          <div className="adm-grid-fields">
            {num("manual_min_minutes")}
            {num("manual_max_minutes")}
            {num("backdate_days")}
            {num("daily_minutes_cap")}
          </div>
        </Group>

        <Group title="Crews">
          <div className="adm-grid-fields">
            {num("crew_min_size")}
            {num("crew_max_size")}
          </div>
        </Group>

        <Group title="Leaderboards">
          <div className="field">
            <span className="label">Default board in the app</span>
            <ScopePicker value={draft.default_board_scope} disabled={disabled} onChange={(v) => set("default_board_scope", v)} />
          </div>
          <fieldset className="adm-checks" disabled={disabled}>
            <legend className="label">Boards players can see</legend>
            {BOARDS.map((b) => (
              <label key={b.value} className="adm-check">
                <input type="checkbox" checked={draft.boards_enabled.includes(b.value)} onChange={() => set("boards_enabled", toggleIn(draft.boards_enabled, b.value))} />
                {b.label}
              </label>
            ))}
          </fieldset>
        </Group>

        <Group title="iPad display">
          <div className="field">
            <span className="label">Minutes shown on the iPad</span>
            <ScopePicker value={draft.display_scope} disabled={disabled} onChange={(v) => set("display_scope", v)} />
          </div>
          {num("display_rotation_seconds")}
          <fieldset className="adm-checks" disabled={disabled}>
            <legend className="label">Screens in the rotation</legend>
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
        </Group>

        <Group title="Rewards">
          <Toggle
            checked={draft.rewards_enabled}
            disabled={disabled}
            onChange={(v) => set("rewards_enabled", v)}
            label="Rewards visible to players"
            description="Master switch. Players only see individual rewards that are also turned on in Rewards."
          />
          {draft.rewards_enabled && !base.rewards_enabled && (
            <Note tone="warn">Only turn this on after Joe has approved the reward terms and how they're fulfilled.</Note>
          )}
        </Group>

        {error && <InlineError>{error}</InlineError>}
        {isOwner && (
          <div className={`adm-savebar ${changed ? "on" : ""}`}>
            <span>{changed ? `${changed} unsaved change${changed === 1 ? "" : "s"}` : "No changes"}</span>
            <div className="adm-actions">
              <Button type="button" variant="ghost" disabled={!changed || saving} onClick={() => setDraft(toDraft(base))}>
                Discard
              </Button>
              <Button type="submit" variant="primary" loading={saving} disabled={!changed || numErrors.length > 0}>
                Save settings
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

function ScopePicker({ value, onChange, disabled }: { value: Scope; onChange: (v: Scope) => void; disabled: boolean }) {
  return (
    <div className={disabled ? "adm-disabled" : ""}>
      <Segmented<Scope>
        label="Scope"
        value={value}
        onChange={(v) => !disabled && onChange(v)}
        options={[
          { value: "verified", label: "Verified only" },
          { value: "community", label: "Include pending" },
        ]}
      />
    </div>
  );
}
