import { useState } from "react";
import { Inbox } from "lucide-react";
import { api } from "../lib/api";
import type { AdminRequest } from "../lib/types";
import { Button, Chip, EmptyState, InlineError, Skeleton, StatusChip, useToast } from "../components/ui";
import { formatDateTime, formatDuration, relativeDay } from "../lib/time";
import { ActionSheet, FilterChips, SectionHead, useLoad } from "./shared";

type Filter = "open" | "resolved" | "dismissed" | "all";
type SheetState = { kind: "resolved" | "dismissed"; r: AdminRequest } | null;

const KIND_LABEL: Record<AdminRequest["kind"], string> = {
  correction: "Correction",
  privacy: "Privacy",
  deletion: "Account deletion",
  other: "Other",
};

export default function Requests({
  isOwner,
  onOpenSession,
  onChanged,
}: {
  isOwner: boolean;
  onOpenSession: (nickname: string) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const { data, error, loading, reload } = useLoad(() => api.admin.requests(filter), [filter]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const done = (text: string) => {
    toast(text);
    void reload();
    onChanged();
  };

  async function reopen(r: AdminRequest) {
    setBusyId(r.id);
    try {
      await api.admin.resolveRequest(r.id, "open", r.admin_response);
      done("Request reopened");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't reopen that request.", "bad");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="adm-section">
      <SectionHead title="Player requests" sub="Corrections, privacy questions and deletion requests." />
      <div className="adm-toolbar">
        <FilterChips<Filter>
          label="Request status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: "Open" },
            { value: "resolved", label: "Resolved" },
            { value: "dismissed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      {loading && !data ? (
        <Skeleton height={120} count={3} />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState icon={<Inbox />} title={filter === "open" ? "No open requests" : "Nothing here"} />
      ) : (
        <ul className="adm-list">
          {data.map((r) => (
            <li key={r.id} className="adm-card">
              <div className="adm-card-top">
                <div className="adm-card-title">
                  <strong>{r.display_name ?? "Deleted account"}</strong>
                  <span>{formatDateTime(r.created_at)}</span>
                </div>
                <div className="adm-chip-col">
                  <Chip tone={r.kind === "deletion" ? "bad" : r.kind === "correction" ? "warn" : "neutral"}>{KIND_LABEL[r.kind]}</Chip>
                  {r.status !== "open" && <Chip tone={r.status === "resolved" ? "ok" : "neutral"}>{r.status === "resolved" ? "Resolved" : "Closed"}</Chip>}
                </div>
              </div>
              <p className="adm-message">{r.message}</p>
              {r.session && (
                <div className="adm-linked">
                  <span>
                    Session: {relativeDay(r.session.played_on)} · {formatDuration(r.session.minutes)} ·{" "}
                    {r.session.method === "timer" ? "live timer" : "logged later"}
                  </span>
                  <StatusChip status={r.session.status} short />
                  {r.display_name && (
                    <Button size="sm" variant="ghost" onClick={() => onOpenSession(r.display_name!)}>
                      Open in Sessions
                    </Button>
                  )}
                </div>
              )}
              {r.kind === "deletion" && r.status === "open" && (
                <p className="adm-small adm-muted">
                  {isOwner ? "Delete the account from Players, then resolve this request." : "An owner can delete the account from Players."}
                </p>
              )}
              {r.admin_response && <p className="adm-small">Reply: {r.admin_response}</p>}
              <div className="adm-actions">
                {r.status === "open" ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => setSheet({ kind: "resolved", r })}>
                      Resolve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "dismissed", r })}>
                      Close
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" loading={busyId === r.id} onClick={() => void reopen(r)}>
                    Reopen
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {sheet && (
        <ActionSheet
          title={sheet.kind === "resolved" ? "Resolve request" : "Close request"}
          description={<p>The player sees your reply with their request.</p>}
          confirmLabel={sheet.kind === "resolved" ? "Mark resolved" : "Close request"}
          text={{
            label: "Reply to the player",
            required: false,
            placeholder: sheet.kind === "resolved" ? "e.g. Fixed — changed to 45 minutes." : "e.g. We couldn't confirm this session.",
          }}
          onSubmit={async (_m, response) => {
            await api.admin.resolveRequest(sheet.r.id, sheet.kind, response || null);
            done(sheet.kind === "resolved" ? "Request resolved" : "Request dismissed");
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
