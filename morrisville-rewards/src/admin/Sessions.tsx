import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { api, type SessionAction } from "../lib/api";
import type { AdminSession, Settings } from "../lib/types";
import { Button, Chip, EmptyState, InlineError, useToast } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { formatDuration, formatTime, relativeDay } from "../lib/time";
import { ActionSheet, FilterChips, SearchBox, SectionHead, flagLabel, useDebounced, useLoad } from "./shared";

type Filter = "all" | "flagged" | "removed";

type SheetState = { kind: "fix" | "remove"; s: AdminSession } | null;

/** Flags worth a second look. "too_short" sessions never count, so they aren't flagged here. */
function flagsOf(s: AdminSession): string[] {
  const set = new Set([...(s.auto_closed ? ["auto_closed"] : []), ...s.flags]);
  set.delete("too_short");
  return [...set];
}

export default function Sessions({
  settings,
  initialSearch,
  onChanged,
}: {
  settings: Settings;
  initialSearch?: string;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState(initialSearch ?? "");
  const q = useDebounced(search.trim());
  const status = filter === "removed" ? "rejected" : "all";
  const { data, error, loading, reload } = useLoad(() => api.admin.sessions(status, q), [status, q]);
  const playing = useLoad(() => api.admin.sessions("active"), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const toast = useToast();

  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

  const rows = useMemo(() => {
    const list = data ?? [];
    if (filter === "flagged") return list.filter((s) => s.status !== "rejected" && flagsOf(s).length > 0);
    return list;
  }, [data, filter]);

  const maxMinutes = Math.max(settings.max_session_minutes, settings.manual_max_minutes);

  async function run(s: AdminSession, action: SessionAction, minutes: number | null, reason: string | null, message: string) {
    await api.admin.reviewSession(s.id, action, minutes, reason);
    toast(message);
    void reload();
    onChanged();
  }

  async function quick(s: AdminSession, kind: "approve" | "restore") {
    setBusyId(s.id);
    try {
      if (kind === "restore") {
        await api.admin.reviewSession(s.id, "reopen", null, "Restored by staff");
        await api.admin.reviewSession(s.id, "approve", null, "Restored by staff");
        toast("Session restored");
      } else {
        await api.admin.reviewSession(s.id, "approve", null, null);
        toast("Session approved");
      }
      void reload();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update that session.", "bad");
    } finally {
      setBusyId(null);
    }
  }

  const live = playing.data ?? [];

  return (
    <section className="adm-section">
      <SectionHead title="Sessions" sub="Sessions count as soon as players log them. Fix or remove mistakes here." />
      {live.length > 0 && (
        <p className="adm-live">
          <span className="adm-live-dot" aria-hidden />
          {live.length === 1 ? "1 person" : `${live.length} people`} playing now: {live.map((s) => s.display_name).join(", ")}
        </p>
      )}
      <div className="adm-toolbar">
        <FilterChips<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "flagged", label: "Flagged" },
            { value: "removed", label: "Removed" },
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Search nickname" />
      </div>

      {loading && !data ? (
        <LogoLoader label="Loading sessions" />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !rows.length ? (
        <EmptyState
          icon={<ClipboardList />}
          title={
            q
              ? `No sessions for "${q}"`
              : filter === "flagged"
                ? "Nothing flagged"
                : filter === "removed"
                  ? "Nothing removed"
                  : "No sessions yet"
          }
          text={!q && filter === "all" ? "Sessions show up here as soon as players finish or log play." : undefined}
        />
      ) : (
        <ul className="adm-rows">
          {rows.map((s) => {
            const flags = flagsOf(s);
            const removed = s.status === "rejected";
            return (
              <li key={s.id} className={`adm-row ${removed ? "adm-row-dim" : ""}`}>
                <div className="adm-row-main">
                  <div className="adm-row-title">
                    <strong>{s.display_name}</strong>
                    {removed && <Chip tone="bad">Removed</Chip>}
                    {s.status === "pending" && <Chip tone="warn">Waiting</Chip>}
                    {flags.map((f) => (
                      <Chip key={f} tone="warn">
                        {flagLabel(f)}
                      </Chip>
                    ))}
                  </div>
                  <span className="adm-row-meta">
                    {relativeDay(s.played_on)} · {s.method === "timer" ? "Timer" : "Logged"}
                    {s.method === "timer" && s.ended_at ? ` · ${formatTime(s.started_at)}–${formatTime(s.ended_at)}` : ""}
                    {s.submitted_minutes != null && s.submitted_minutes !== s.minutes ? ` · was ${s.submitted_minutes} min` : ""}
                  </span>
                  {s.note && <span className="adm-row-note">“{s.note}”</span>}
                  {s.review_reason && (removed || s.reviewed_by_name) && (
                    <span className="adm-row-note">
                      {s.reviewed_by_name ? `${s.reviewed_by_name}: ` : ""}
                      {s.review_reason}
                    </span>
                  )}
                </div>
                <span className="adm-row-value num">
                  {s.minutes}
                  <small>min</small>
                </span>
                <div className="adm-row-actions">
                  {s.is_own ? (
                    <span className="adm-row-own">Your session</span>
                  ) : removed ? (
                    <Button size="sm" loading={busyId === s.id} onClick={() => void quick(s, "restore")}>
                      Restore
                    </Button>
                  ) : (
                    <>
                      {s.status === "pending" && (
                        <Button size="sm" variant="primary" loading={busyId === s.id} onClick={() => void quick(s, "approve")}>
                          Approve
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setSheet({ kind: "fix", s })}>
                        Fix minutes
                      </Button>
                      <Button size="sm" variant="ghost" className="adm-remove" onClick={() => setSheet({ kind: "remove", s })}>
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sheet?.kind === "fix" && (
        <ActionSheet
          title="Fix minutes"
          description={
            <p>
              {sheet.s.display_name} · {relativeDay(sheet.s.played_on)} · now {formatDuration(sheet.s.minutes)}
            </p>
          }
          confirmLabel="Save minutes"
          minutes={{ initial: sheet.s.minutes, label: "Correct minutes", min: 1, max: maxMinutes }}
          text={{ label: "Note", required: false, placeholder: "e.g. Left the timer running after they finished" }}
          onSubmit={(m, note) =>
            run(sheet.s, sheet.s.status === "pending" ? "approve" : "adjust", m, note || "Corrected by staff", "Minutes updated")
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "remove" && (
        <ActionSheet
          title="Remove session?"
          danger
          description={
            <p>
              {sheet.s.display_name} · {relativeDay(sheet.s.played_on)} · {formatDuration(sheet.s.minutes)}. It stops counting
              everywhere. You can restore it later.
            </p>
          }
          confirmLabel="Remove session"
          text={{ label: "Note", required: false, placeholder: "e.g. Duplicate of their timer session", hint: "The player sees this note in their history." }}
          onSubmit={(_m, note) => run(sheet.s, "reject", null, note || "Removed by staff", "Session removed")}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
