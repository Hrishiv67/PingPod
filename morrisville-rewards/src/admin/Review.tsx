import { useEffect, useMemo, useState } from "react";
import { CheckCheck, ClipboardCheck, Timer } from "lucide-react";
import { api, type SessionAction } from "../lib/api";
import type { AdminSession, Settings } from "../lib/types";
import { Avatar, Button, Chip, ConfirmSheet, EmptyState, InlineError, Skeleton, StatusChip, useToast } from "../components/ui";
import { formatClock, formatDuration, formatTime, relativeDay } from "../lib/time";
import { ActionSheet, FilterChips, SearchBox, SectionHead, flagLabel, pluralize, useDebounced, useLoad } from "./shared";

export type ReviewStatus = "pending" | "approved" | "rejected" | "all" | "active";

type SheetState =
  | { kind: "reject"; s: AdminSession }
  | { kind: "minutes"; s: AdminSession }
  | { kind: "reopen"; s: AdminSession }
  | { kind: "bulk"; ids: string[] }
  | null;

export default function Review({
  settings,
  initialSearch,
  onChanged,
}: {
  settings: Settings;
  initialSearch?: string;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<ReviewStatus>("all");
  const [search, setSearch] = useState(initialSearch ?? "");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useLoad(() => api.admin.sessions(status, q), [status, q]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [now, setNow] = useState(Date.now());
  const toast = useToast();

  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch);
      setStatus("all");
    }
  }, [initialSearch]);

  useEffect(() => {
    if (status !== "active") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const maxMinutes = Math.max(settings.max_session_minutes, settings.manual_max_minutes);
  const pendingIds = useMemo(
    () => (data ?? []).filter((s) => s.status === "pending" && !s.is_own).map((s) => s.id),
    [data],
  );

  async function act(s: AdminSession, action: SessionAction, minutes?: number | null, reason?: string | null) {
    await api.admin.reviewSession(s.id, action, minutes ?? null, reason || null);
    const verb = { approve: "Approved", reject: "Rejected", adjust: "Updated", reopen: "Reopened" }[action];
    toast(`${verb} ${s.display_name}'s session`);
    void reload();
    onChanged();
  }

  async function quickApprove(s: AdminSession) {
    setBusyId(s.id);
    try {
      await act(s, "approve");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't approve that session.", "bad");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="adm-section">
      <SectionHead
        title="Review"
        sub="Every session counts as soon as a player logs it. Fix or remove anything that looks wrong."
        actions={
          status === "pending" && pendingIds.length > 1 ? (
            <Button variant="primary" icon={<CheckCheck size={18} />} onClick={() => setSheet({ kind: "bulk", ids: pendingIds })}>
              Approve all ({pendingIds.length})
            </Button>
          ) : undefined
        }
      />
      <div className="adm-toolbar">
        <FilterChips<ReviewStatus>
          label="Session status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "pending", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
            { value: "all", label: "All" },
            { value: "active", label: "Playing now" },
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Search nickname" />
      </div>

      {loading && !data ? (
        <Skeleton height={132} count={4} />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState
          icon={status === "active" ? <Timer /> : <ClipboardCheck />}
          title={
            status === "pending"
              ? "You're all caught up"
              : status === "active"
                ? "Nobody has a timer running"
                : "No sessions here"
          }
          text={status === "pending" ? "New sessions show up here when players finish or log play." : q ? `Nothing matches "${q}".` : undefined}
        />
      ) : (
        <ul className="adm-list">
          {data.map((s) => (
            <li key={s.id} className={`adm-card ${s.is_own ? "adm-card-muted" : ""}`}>
              <div className="adm-card-top">
                <Avatar name={s.display_name} size={36} />
                <div className="adm-card-title">
                  <strong>{s.display_name}</strong>
                  <span>
                    {pluralize(s.player_sessions, "counted session")}
                    {s.player_rejections > 0 && <b className="adm-warn-text"> · {s.player_rejections} rejected</b>}
                  </span>
                </div>
                <StatusChip status={s.status} short />
              </div>

              <div className="adm-session-main">
                <span className="adm-big num">
                  {s.status === "active" ? formatClock(now - new Date(s.started_at).getTime()) : formatDuration(s.minutes)}
                </span>
                {s.submitted_minutes != null && s.submitted_minutes !== s.minutes && s.status !== "active" && (
                  <span className="adm-muted">submitted {formatDuration(s.submitted_minutes)}</span>
                )}
              </div>
              <div className="adm-meta">
                <Chip>{s.method === "timer" ? "Live timer" : "Logged later"}</Chip>
                <span>{relativeDay(s.played_on)}</span>
                <span>
                  {formatTime(s.started_at)}
                  {s.ended_at ? `–${formatTime(s.ended_at)}` : " → now"}
                </span>
                {s.method === "manual" && <span className="adm-muted">(times estimated)</span>}
              </div>
              {s.note && <blockquote className="adm-quote">“{s.note}”</blockquote>}
              {(s.flags.length > 0 || s.auto_closed) && (
                <div className="adm-flags">
                  {Array.from(new Set([...(s.auto_closed ? ["auto_closed"] : []), ...s.flags])).map((f) => (
                    <Chip key={f} tone={f === "too_short" ? "neutral" : "warn"}>
                      {flagLabel(f)}
                    </Chip>
                  ))}
                </div>
              )}
              {s.reviewed_at && s.status !== "pending" && (
                <p className="adm-muted adm-small">
                  {s.status === "approved" ? "Approved" : s.status === "rejected" ? "Rejected" : "Reviewed"}
                  {s.reviewed_by_name ? ` by ${s.reviewed_by_name}` : ""}
                  {s.review_reason ? ` — ${s.review_reason}` : ""}
                </p>
              )}

              {s.is_own ? (
                <p className="adm-muted adm-small">Your own session — another staff member must review it.</p>
              ) : s.status === "pending" ? (
                <div className="adm-actions">
                  <Button variant="primary" size="sm" loading={busyId === s.id} onClick={() => void quickApprove(s)}>
                    Approve
                  </Button>
                  <Button size="sm" onClick={() => setSheet({ kind: "minutes", s })}>
                    Change minutes
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setSheet({ kind: "reject", s })}>
                    Reject
                  </Button>
                </div>
              ) : s.status === "approved" ? (
                <div className="adm-actions">
                  <Button size="sm" onClick={() => setSheet({ kind: "minutes", s })}>
                    Adjust minutes
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setSheet({ kind: "reject", s })}>
                    Reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "reopen", s })}>
                    Reopen
                  </Button>
                </div>
              ) : s.status === "rejected" ? (
                <div className="adm-actions">
                  <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "reopen", s })}>
                    Reopen
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {sheet?.kind === "minutes" && (
        <ActionSheet
          title={sheet.s.status === "pending" ? "Approve with different minutes" : "Adjust minutes"}
          description={
            <p>
              {sheet.s.display_name} · {relativeDay(sheet.s.played_on)} · currently {formatDuration(sheet.s.minutes)}.
              {sheet.s.status === "pending" ? " This approves the session with the new number." : ""}
            </p>
          }
          confirmLabel={sheet.s.status === "pending" ? "Approve" : "Save minutes"}
          minutes={{ initial: sheet.s.minutes, label: "Minutes", min: 1, max: maxMinutes }}
          text={{ label: "Reason", required: true, placeholder: "e.g. Left the timer running after they finished" }}
          onSubmit={(m, reason) => act(sheet.s, sheet.s.status === "pending" ? "approve" : "adjust", m, reason)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "reject" && (
        <ActionSheet
          title="Reject session"
          danger
          description={
            <p>
              {sheet.s.display_name} · {relativeDay(sheet.s.played_on)} · {formatDuration(sheet.s.minutes)}. Rejected time never
              counts on any board.
            </p>
          }
          confirmLabel="Reject"
          text={{
            label: "Reason",
            required: sheet.s.status === "approved",
            placeholder: "e.g. Duplicate of the timer session",
            hint: "The player sees this decision in their history.",
          }}
          onSubmit={(_m, reason) => act(sheet.s, "reject", null, reason)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "reopen" && (
        <ActionSheet
          title="Reopen session"
          description={<p>This moves the session back to Pending so it can be reviewed again.</p>}
          confirmLabel="Reopen"
          text={{ label: "Reason", required: true, placeholder: "e.g. Player sent a correction request" }}
          onSubmit={(_m, reason) => act(sheet.s, "reopen", null, reason)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "bulk" && (
        <ConfirmSheet
          title={`Approve ${pluralize(sheet.ids.length, "session")}?`}
          body={
            <p>
              Every pending session shown here will be approved and start counting on verified boards. Your own sessions are
              skipped.
            </p>
          }
          confirmLabel="Approve all"
          onConfirm={async () => {
            const n = await api.admin.bulkApprove(sheet.ids);
            toast(`Approved ${pluralize(n, "session")}`);
            void reload();
            onChanged();
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
