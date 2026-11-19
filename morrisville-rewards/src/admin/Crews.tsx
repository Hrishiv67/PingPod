import { useState } from "react";
import { UsersRound } from "lucide-react";
import { api, errorText } from "../lib/api";
import type { AdminCrew } from "../lib/types";
import { Avatar, Button, Chip, EmptyState, InlineError, Sheet, Skeleton, Toggle, useToast } from "../components/ui";
import { formatDateTime, formatNumber } from "../lib/time";
import { ActionSheet, SectionHead, pluralize, useLoad } from "./shared";

type SheetState =
  | { kind: "rename" | "hide" | "archive"; c: AdminCrew }
  | { kind: "transfer" | "remove"; c: AdminCrew }
  | null;

export default function Crews({ onChanged }: { onChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.admin.crews(), []);
  const [showArchived, setShowArchived] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();
  const crews = (data ?? []).filter((c) => showArchived || !c.archived_at);
  const archivedCount = (data ?? []).filter((c) => c.archived_at).length;

  const done = (text: string) => {
    toast(text);
    void reload();
    onChanged();
  };

  async function unhide(c: AdminCrew) {
    setBusyId(c.id);
    try {
      await api.admin.moderateCrew(c.id, "unhide");
      done(`${c.name} is visible again`);
    } catch (err) {
      toast(errorText(err), "bad");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="adm-section">
      <SectionHead title="Crews" sub="Crew totals only count play while each person was a member." />
      {archivedCount > 0 && (
        <div className="adm-toolbar">
          <Toggle checked={showArchived} onChange={setShowArchived} label={`Show archived crews (${archivedCount})`} />
        </div>
      )}
      {loading && !data ? (
        <Skeleton height={140} count={3} />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !crews.length ? (
        <EmptyState icon={<UsersRound />} title="No crews yet" text="Crews appear here when players create them." />
      ) : (
        <ul className="adm-list">
          {crews.map((c) => (
            <li key={c.id} className={`adm-card ${c.archived_at ? "adm-card-muted" : ""}`}>
              <div className="adm-card-top">
                <div className="adm-card-title">
                  <strong>{c.name}</strong>
                  <span>
                    {pluralize(c.members.length, "member")}
                    {c.past_members > 0 ? ` · ${c.past_members} left` : ""} · created {formatDateTime(c.created_at)}
                  </span>
                </div>
                <div className="adm-chip-col">
                  {c.archived_at && <Chip>Archived</Chip>}
                  {c.hidden_by_admin && <Chip tone="bad">Hidden</Chip>}
                </div>
              </div>
              <dl className="adm-stats adm-stats-3">
                <div>
                  <dt>Owner</dt>
                  <dd>{c.owner_name ?? "—"}</dd>
                </div>
                <div>
                  <dt>Invite code</dt>
                  <dd className="num adm-code">{c.invite_code}</dd>
                </div>
                <div>
                  <dt>Verified this week</dt>
                  <dd className="num">{c.week_verified_minutes == null ? "—" : `${formatNumber(c.week_verified_minutes)} min`}</dd>
                </div>
              </dl>
              {c.members.length > 0 && (
                <ul className="adm-members">
                  {c.members.map((m) => (
                    <li key={m.user_id}>
                      <Avatar name={m.display_name} size={24} />
                      <span>{m.display_name}</span>
                      {m.user_id === c.owner_id && <Chip tone="pink">Owner</Chip>}
                    </li>
                  ))}
                </ul>
              )}
              {c.hidden_by_admin && c.hidden_reason && <p className="adm-small adm-warn-text">Hidden: {c.hidden_reason}</p>}
              {!c.archived_at && (
                <div className="adm-actions">
                  <Button size="sm" onClick={() => setSheet({ kind: "rename", c })}>
                    Rename
                  </Button>
                  {c.hidden_by_admin ? (
                    <Button size="sm" loading={busyId === c.id} onClick={() => void unhide(c)}>
                      Unhide
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setSheet({ kind: "hide", c })}>
                      Hide
                    </Button>
                  )}
                  {c.members.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "transfer", c })}>
                      Transfer ownership
                    </Button>
                  )}
                  {c.members.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "remove", c })}>
                      Remove member
                    </Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => setSheet({ kind: "archive", c })}>
                    Archive
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {sheet?.kind === "rename" && (
        <ActionSheet
          title="Rename crew"
          confirmLabel="Save name"
          text={{ label: "New crew name", required: true, initial: sheet.c.name, maxLength: 24, hint: "3–24 characters." }}
          onSubmit={async (_m, value) => {
            await api.admin.moderateCrew(sheet.c.id, "rename", value, "Renamed by staff");
            done("Crew renamed");
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "hide" && (
        <ActionSheet
          title="Hide crew"
          description={<p>{sheet.c.name} disappears from the crew board and the iPad. Members can still see their crew.</p>}
          confirmLabel="Hide crew"
          text={{ label: "Reason", required: false, placeholder: "e.g. Inappropriate name" }}
          onSubmit={async (_m, reason) => {
            await api.admin.moderateCrew(sheet.c.id, "hide", null, reason);
            done(`${sheet.c.name} is hidden`);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "archive" && (
        <ActionSheet
          title="Archive crew"
          danger
          description={<p>Everyone is removed from {sheet.c.name} and it leaves every board. Membership history is kept.</p>}
          confirmLabel="Archive crew"
          text={{ label: "Reason", required: false, placeholder: "e.g. Duplicate crew" }}
          onSubmit={async (_m, reason) => {
            await api.admin.moderateCrew(sheet.c.id, "archive", null, reason);
            done(`${sheet.c.name} archived`);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {(sheet?.kind === "transfer" || sheet?.kind === "remove") && (
        <MemberSheet
          crew={sheet.c}
          mode={sheet.kind}
          onClose={() => setSheet(null)}
          onDone={(text) => done(text)}
        />
      )}
    </section>
  );
}

function MemberSheet({
  crew,
  mode,
  onClose,
  onDone,
}: {
  crew: AdminCrew;
  mode: "transfer" | "remove";
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const choices = crew.members.filter((m) => mode === "remove" || m.user_id !== crew.owner_id);
  const [picked, setPicked] = useState(choices[0]?.user_id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = choices.find((m) => m.user_id === picked)?.display_name ?? "";
  return (
    <Sheet title={mode === "transfer" ? "Transfer ownership" : "Remove member"} onClose={onClose}>
      <p className="sheet-text">
        {mode === "transfer"
          ? `Choose the new owner of ${crew.name}.`
          : `The player leaves ${crew.name}. Play they did while a member stays with the crew. If you remove the owner, the longest-standing member takes over.`}
      </p>
      <div className="adm-radio-list" role="radiogroup" aria-label="Crew members">
        {choices.map((m) => (
          <label key={m.user_id} className={`adm-radio ${picked === m.user_id ? "on" : ""}`}>
            <input type="radio" name="member" checked={picked === m.user_id} onChange={() => setPicked(m.user_id)} />
            <Avatar name={m.display_name} size={28} />
            <span>{m.display_name}</span>
            {m.user_id === crew.owner_id && <Chip tone="pink">Owner</Chip>}
          </label>
        ))}
      </div>
      {mode === "remove" && (
        <div className="field">
          <label htmlFor="adm-remove-reason">
            Reason<span className="adm-optional"> (optional)</span>
          </label>
          <input id="adm-remove-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {error && <InlineError>{error}</InlineError>}
      <div className="stack-sm">
        <Button
          variant={mode === "remove" ? "danger" : "primary"}
          size="lg"
          block
          loading={busy}
          disabled={!picked}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api.admin.moderateCrew(crew.id, mode === "transfer" ? "transfer" : "remove_member", picked, reason || null);
              onDone(mode === "transfer" ? `${name} now owns ${crew.name}` : `${name} removed from ${crew.name}`);
              onClose();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "transfer" ? "Make owner" : "Remove from crew"}
        </Button>
        <Button variant="ghost" size="lg" block onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
