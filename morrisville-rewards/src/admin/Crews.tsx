import { useState } from "react";
import { UsersRound } from "lucide-react";
import { api, errorText } from "../lib/api";
import type { AdminCrew } from "../lib/types";
import { Avatar, Button, Chip, EmptyState, InlineError, Sheet, Toggle, useToast } from "../components/ui";
import CrewBadge from "../components/CrewBadge";
import LogoLoader from "../components/LogoLoader";
import { formatDay, formatNumber } from "../lib/time";
import { ActionSheet, SectionHead, useLoad } from "./shared";

type SheetState =
  | { kind: "manage" | "rename" | "hide" | "archive"; c: AdminCrew }
  | { kind: "transfer" | "remove"; c: AdminCrew }
  | null;

export default function Crews({ onChanged }: { onChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.admin.crews(), []);
  const [showArchived, setShowArchived] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const toast = useToast();
  const crews = (data ?? []).filter((c) => showArchived || !c.archived_at);
  const archivedCount = (data ?? []).filter((c) => c.archived_at).length;

  const done = (text: string) => {
    toast(text);
    void reload();
    onChanged();
  };

  async function unhide(c: AdminCrew) {
    try {
      await api.admin.moderateCrew(c.id, "unhide");
      done(`${c.name} is back on the leaderboards`);
    } catch (err) {
      toast(errorText(err), "bad");
    }
  }

  return (
    <section className="adm-section">
      <SectionHead title="Crews" sub="Crew totals count each member's play from when they joined." />
      {archivedCount > 0 && (
        <div className="adm-toolbar">
          <Toggle checked={showArchived} onChange={setShowArchived} label={`Show closed crews (${archivedCount})`} />
        </div>
      )}
      {loading && !data ? (
        <LogoLoader label="Loading crews" />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !crews.length ? (
        <EmptyState icon={<UsersRound />} title="No crews yet" text="Crews appear here when players create them." />
      ) : (
        <ul className="adm-rows">
          {crews.map((c) => (
            <li key={c.id} className={`adm-row ${c.archived_at ? "adm-row-dim" : ""}`}>
              <div className="adm-row-main">
                <div className="adm-row-title">
                  <CrewBadge emblem={c.emblem} color={c.color} size={26} />
                  <strong>{c.name}</strong>
                  {c.archived_at && <Chip>Closed</Chip>}
                  {c.hidden_by_admin && <Chip tone="bad">Hidden</Chip>}
                </div>
                <span className="adm-row-meta">
                  {c.members.length ? c.members.map((m) => (m.user_id === c.owner_id ? `${m.display_name} (owner)` : m.display_name)).join(", ") : "No members"}
                </span>
                <span className="adm-row-meta">
                  Code <span className="adm-code">{c.invite_code}</span> · started {formatDay(c.created_at.slice(0, 10))}
                  {c.past_members > 0 ? ` · ${c.past_members} left` : ""}
                </span>
                {c.motto && <span className="adm-row-meta adm-bio">“{c.motto}”</span>}
                {c.hidden_by_admin && c.hidden_reason && <span className="adm-row-note">Hidden: {c.hidden_reason}</span>}
              </div>
              <span className="adm-row-value num">
                {c.week_verified_minutes == null ? "—" : formatNumber(c.week_verified_minutes)}
                <small>min this week</small>
              </span>
              <div className="adm-row-actions">
                {!c.archived_at && (
                  <Button size="sm" onClick={() => setSheet({ kind: "manage", c })}>
                    Manage
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {sheet?.kind === "manage" && (
        <Sheet title={sheet.c.name} onClose={() => setSheet(null)}>
          <div className="adm-manage">
            <Button size="lg" block onClick={() => setSheet({ kind: "rename", c: sheet.c })}>
              Rename crew
            </Button>
            {sheet.c.motto && (
              <Button
                size="lg"
                block
                onClick={async () => {
                  const c = sheet.c;
                  setSheet(null);
                  try {
                    await api.admin.moderateCrew(c.id, "clear_motto");
                    done(`Motto cleared for ${c.name}`);
                  } catch (err) {
                    toast(errorText(err), "bad");
                  }
                }}
              >
                Clear motto
              </Button>
            )}
            {sheet.c.hidden_by_admin ? (
              <Button
                size="lg"
                block
                onClick={() => {
                  const c = sheet.c;
                  setSheet(null);
                  void unhide(c);
                }}
              >
                Show on leaderboards again
              </Button>
            ) : (
              <Button size="lg" block onClick={() => setSheet({ kind: "hide", c: sheet.c })}>
                Hide from leaderboards
              </Button>
            )}
            {sheet.c.members.length > 1 && (
              <Button size="lg" block variant="ghost" onClick={() => setSheet({ kind: "transfer", c: sheet.c })}>
                Change owner
              </Button>
            )}
            {sheet.c.members.length > 0 && (
              <Button size="lg" block variant="ghost" onClick={() => setSheet({ kind: "remove", c: sheet.c })}>
                Remove a member
              </Button>
            )}
            <Button size="lg" block variant="danger" onClick={() => setSheet({ kind: "archive", c: sheet.c })}>
              Close crew
            </Button>
          </div>
        </Sheet>
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
          title="Hide from leaderboards"
          description={<p>{sheet.c.name} disappears from the crew board and the iPad. Members can still see their crew.</p>}
          confirmLabel="Hide crew"
          text={{ label: "Reason", required: false, placeholder: "e.g. Inappropriate name" }}
          onSubmit={async (_m, reason) => {
            await api.admin.moderateCrew(sheet.c.id, "hide", null, reason);
            done(`${sheet.c.name} is hidden from leaderboards`);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "archive" && (
        <ActionSheet
          title="Close crew?"
          danger
          description={<p>Everyone leaves {sheet.c.name} and it disappears from every board. Past minutes stay in the history.</p>}
          confirmLabel="Close crew"
          text={{ label: "Reason", required: false, placeholder: "e.g. Duplicate crew" }}
          onSubmit={async (_m, reason) => {
            await api.admin.moderateCrew(sheet.c.id, "archive", null, reason);
            done(`${sheet.c.name} closed`);
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
    <Sheet title={mode === "transfer" ? "Change owner" : "Remove a member"} onClose={onClose}>
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
