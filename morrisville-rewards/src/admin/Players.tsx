import { useState } from "react";
import { Users } from "lucide-react";
import { api } from "../lib/api";
import type { AdminPlayer, StaffRole } from "../lib/types";
import { Avatar, Button, Chip, ConfirmSheet, EmptyState, InlineError, Skeleton, useToast } from "../components/ui";
import { formatDateTime, formatNumber, timeAgo } from "../lib/time";
import { ActionSheet, OwnerOnly, SearchBox, SectionHead, useDebounced, useLoad } from "./shared";

type SheetState =
  | { kind: "rename" | "hide" | "delete"; p: AdminPlayer }
  | { kind: "role"; p: AdminPlayer; role: StaffRole | null }
  | null;

export default function Players({
  isOwner,
  myId,
  onChanged,
}: {
  isOwner: boolean;
  myId: string;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useLoad(() => api.admin.players(q), [q]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const done = (text: string) => {
    toast(text);
    void reload();
    onChanged();
  };

  async function unhide(p: AdminPlayer) {
    setBusyId(p.id);
    try {
      await api.admin.moderatePlayer(p.id, "unhide");
      done(`${p.display_name} is visible on boards again`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update that player.", "bad");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="adm-section">
      <SectionHead
        title="Players"
        sub="Emails are staff-only. Rename or hide anything inappropriate; players keep their own stats."
      />
      <div className="adm-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search nickname or email" />
      </div>
      {!isOwner && <OwnerOnly>Owners can add staff and delete accounts.</OwnerOnly>}

      {loading && !data ? (
        <Skeleton height={120} count={4} />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState icon={<Users />} title={q ? "No matching players" : "No players yet"} text={q ? `Nothing matches "${q}".` : "Accounts appear here after people sign up."} />
      ) : (
        <ul className="adm-list">
          {data.map((p) => {
            const name = p.display_name ?? "No nickname yet";
            const self = p.id === myId;
            return (
              <li key={p.id} className="adm-card">
                <div className="adm-card-top">
                  <Avatar name={p.display_name ?? "?"} color={p.avatar_color} size={36} />
                  <div className="adm-card-title">
                    <strong>
                      {name}
                      {self && <span className="adm-muted"> (you)</span>}
                    </strong>
                    <span className="adm-email">{p.email ?? "—"}</span>
                  </div>
                  <div className="adm-chip-col">
                    {p.admin_role && <Chip tone="pink">{p.admin_role === "owner" ? "Owner" : "Staff"}</Chip>}
                    {p.hidden_by_admin && <Chip tone="bad">Hidden</Chip>}
                    {p.display_name && p.show_on_leaderboard === false && <Chip>Private</Chip>}
                  </div>
                </div>
                <dl className="adm-stats">
                  <div>
                    <dt>Sessions</dt>
                    <dd className="num">{p.sessions}</dd>
                  </div>
                  <div>
                    <dt>Verified min</dt>
                    <dd className="num">{formatNumber(p.approved_minutes)}</dd>
                  </div>
                  <div>
                    <dt>Pending min</dt>
                    <dd className="num">{formatNumber(p.pending_minutes)}</dd>
                  </div>
                  <div>
                    <dt>SPINDEX</dt>
                    <dd>
                      {p.spindex ? (
                        <>
                          <span className="num">{p.spindex.rating}</span>{" "}
                          <small className="adm-muted">{p.spindex.status === "verified" ? "verified" : "self-reported"}</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="adm-muted adm-small">
                  {p.crew_name ? `Crew: ${p.crew_name} · ` : ""}Joined {formatDateTime(p.created_at)}
                  {p.last_sign_in_at ? ` · last sign-in ${timeAgo(p.last_sign_in_at)}` : ""}
                </p>
                {p.hidden_by_admin && p.hidden_reason && <p className="adm-small adm-warn-text">Hidden: {p.hidden_reason}</p>}
                <div className="adm-actions">
                  {p.display_name && (
                    <>
                      <Button size="sm" onClick={() => setSheet({ kind: "rename", p })}>
                        Rename
                      </Button>
                      {p.hidden_by_admin ? (
                        <Button size="sm" loading={busyId === p.id} onClick={() => void unhide(p)}>
                          Unhide
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => setSheet({ kind: "hide", p })}>
                          Hide from boards
                        </Button>
                      )}
                    </>
                  )}
                  {isOwner && !self && p.display_name && (
                    <>
                      {p.admin_role !== "staff" && (
                        <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "role", p, role: "staff" })}>
                          Make staff
                        </Button>
                      )}
                      {p.admin_role !== "owner" && (
                        <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "role", p, role: "owner" })}>
                          Make owner
                        </Button>
                      )}
                      {p.admin_role && (
                        <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "role", p, role: null })}>
                          Remove staff
                        </Button>
                      )}
                    </>
                  )}
                  {isOwner && !self && !p.admin_role && (
                    <Button size="sm" variant="danger" onClick={() => setSheet({ kind: "delete", p })}>
                      Delete account
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sheet?.kind === "rename" && (
        <ActionSheet
          title="Rename player"
          description={<p>Use this for nicknames that break the rules. The player sees the new name right away.</p>}
          confirmLabel="Save nickname"
          text={{ label: "New nickname", required: true, initial: sheet.p.display_name ?? "", maxLength: 20, hint: "2–20 letters or numbers; spaces, _ . - allowed." }}
          onSubmit={async (_m, value) => {
            await api.admin.moderatePlayer(sheet.p.id, "rename", value, "Renamed by staff");
            done("Nickname updated");
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "hide" && (
        <ActionSheet
          title="Hide from boards"
          description={<p>{sheet.p.display_name} disappears from every public board and the iPad. Their own stats stay visible to them.</p>}
          confirmLabel="Hide player"
          text={{ label: "Reason", required: false, placeholder: "e.g. Offensive nickname" }}
          onSubmit={async (_m, reason) => {
            await api.admin.moderatePlayer(sheet.p.id, "hide", null, reason);
            done(`${sheet.p.display_name} is hidden from boards`);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "role" && (
        <ConfirmSheet
          title={sheet.role ? `Make ${sheet.p.display_name} ${sheet.role === "owner" ? "an owner" : "staff"}?` : "Remove staff access?"}
          body={
            sheet.role === "owner" ? (
              <p>Owners can review sessions, change settings and rewards, manage staff, and delete accounts.</p>
            ) : sheet.role === "staff" ? (
              <p>Staff can review sessions, moderate names and crews, verify SPINDEX, and see analytics.</p>
            ) : (
              <p>{sheet.p.display_name} goes back to being a regular player.</p>
            )
          }
          confirmLabel={sheet.role ? "Confirm" : "Remove access"}
          danger={!sheet.role}
          onConfirm={async () => {
            await api.admin.setStaff(sheet.p.id, sheet.role);
            done(sheet.role ? "Staff access updated" : "Staff access removed");
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "delete" && (
        <ActionSheet
          title="Delete account"
          danger
          description={
            <p>
              This permanently deletes <b>{sheet.p.display_name ?? sheet.p.email}</b>, their sessions, crew memberships and ratings. It
              can't be undone. Use it for deletion requests or serious abuse.
            </p>
          }
          confirmLabel="Delete permanently"
          text={{ label: "Reason", required: true, placeholder: "e.g. Player asked to delete their account (request 11/20)" }}
          onSubmit={async (_m, reason) => {
            await api.admin.deletePlayer(sheet.p.id, reason);
            done("Account deleted");
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
