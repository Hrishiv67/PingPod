import { useState } from "react";
import { Users } from "lucide-react";
import { api } from "../lib/api";
import type { AdminPlayer, StaffRole } from "../lib/types";
import { Avatar, Button, Chip, ConfirmSheet, EmptyState, InlineError, Sheet, useToast } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { formatDay, formatNumber } from "../lib/time";
import { ActionSheet, OwnerOnly, SearchBox, SectionHead, useDebounced, useLoad } from "./shared";

type SheetState =
  | { kind: "manage" | "rename" | "hide" | "delete"; p: AdminPlayer }
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

  async function clearField(p: AdminPlayer, action: "clear_photo" | "clear_bio") {
    setSheet(null);
    setBusyId(p.id);
    try {
      await api.admin.moderatePlayer(p.id, action);
      done(action === "clear_photo" ? "Photo removed." : "Bio cleared.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update that player.", "bad");
    } finally {
      setBusyId(null);
    }
  }

  async function unhide(p: AdminPlayer) {
    setBusyId(p.id);
    try {
      await api.admin.moderatePlayer(p.id, "unhide");
      done(`${p.display_name} is back on the leaderboards`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update that player.", "bad");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="adm-section">
      <SectionHead title="Players" sub={data ? `${data.length} ${data.length === 1 ? "account" : "accounts"} · emails are only visible to staff` : undefined} />
      <div className="adm-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search nickname or email" />
      </div>
      {loading && !data ? (
        <LogoLoader label="Loading players" />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState icon={<Users />} title={q ? "No matching players" : "No players yet"} text={q ? `Nothing matches "${q}".` : "Accounts appear here after people sign up."} />
      ) : (
        <ul className="adm-rows">
          {data.map((p) => {
            const name = p.display_name ?? "No nickname yet";
            const self = p.id === myId;
            const minutes = p.approved_minutes + p.pending_minutes;
            return (
              <li key={p.id} className="adm-row">
                <div className="adm-row-main adm-row-with-avatar">
                  <Avatar name={p.display_name ?? "?"} color={p.avatar_color} path={p.avatar_path} size={36} />
                  <div className="adm-row-text">
                    <div className="adm-row-title">
                      <strong>
                        {name}
                        {self && <span className="adm-muted"> (you)</span>}
                      </strong>
                      {p.admin_role && <Chip tone="pink">{p.admin_role === "owner" ? "Owner" : "Staff"}</Chip>}
                      {p.hidden_by_admin && <Chip tone="bad">Hidden</Chip>}
                      {p.email_verified_at && <Chip tone="ok">Verified email</Chip>}
                    </div>
                    <span className="adm-row-meta adm-email">{p.email ?? "No email"}</span>
                    {p.bio && <span className="adm-row-meta adm-bio">“{p.bio}”</span>}
                    <span className="adm-row-meta">
                      {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
                      {p.crew_name ? ` · ${p.crew_name}` : ""}
                      {p.display_name && p.show_on_leaderboard === false ? " · Private" : ""}
                      {p.spindex ? ` · SPINDEX ${p.spindex.rating}${p.spindex.status === "verified" ? " ✓" : ""}` : ""}
                      {` · joined ${formatDay(p.created_at.slice(0, 10))}`}
                    </span>
                  </div>
                </div>
                <span className="adm-row-value num">
                  {formatNumber(minutes)}
                  <small>min</small>
                </span>
                <div className="adm-row-actions">
                  {p.hidden_by_admin && p.display_name ? (
                    <Button size="sm" loading={busyId === p.id} onClick={() => void unhide(p)}>
                      Unhide
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => setSheet({ kind: "manage", p })}>
                    Manage
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sheet?.kind === "manage" && (
        <Sheet title={sheet.p.display_name ?? sheet.p.email ?? "Player"} onClose={() => setSheet(null)}>
          <div className="adm-manage">
            {sheet.p.display_name ? (
              <>
                <Button size="lg" block onClick={() => setSheet({ kind: "rename", p: sheet.p })}>
                  Change nickname
                </Button>
                {sheet.p.avatar_path && (
                  <Button size="lg" block onClick={() => void clearField(sheet.p, "clear_photo")}>
                    Remove photo
                  </Button>
                )}
                {sheet.p.bio && (
                  <Button size="lg" block onClick={() => void clearField(sheet.p, "clear_bio")}>
                    Clear bio
                  </Button>
                )}
                {sheet.p.hidden_by_admin ? (
                  <Button
                    size="lg"
                    block
                    onClick={() => {
                      const p = sheet.p;
                      setSheet(null);
                      void unhide(p);
                    }}
                  >
                    Show on leaderboards again
                  </Button>
                ) : (
                  <Button size="lg" block onClick={() => setSheet({ kind: "hide", p: sheet.p })}>
                    Hide from leaderboards
                  </Button>
                )}
              </>
            ) : (
              <p className="sheet-text">This person signed up but hasn't picked a nickname yet.</p>
            )}
            {isOwner && sheet.p.id !== myId && sheet.p.display_name && (
              <>
                {sheet.p.admin_role !== "staff" && (
                  <Button size="lg" block variant="ghost" onClick={() => setSheet({ kind: "role", p: sheet.p, role: "staff" })}>
                    Make staff
                  </Button>
                )}
                {sheet.p.admin_role !== "owner" && (
                  <Button size="lg" block variant="ghost" onClick={() => setSheet({ kind: "role", p: sheet.p, role: "owner" })}>
                    Make owner
                  </Button>
                )}
                {sheet.p.admin_role && (
                  <Button size="lg" block variant="ghost" onClick={() => setSheet({ kind: "role", p: sheet.p, role: null })}>
                    Remove staff access
                  </Button>
                )}
              </>
            )}
            {isOwner && sheet.p.id !== myId && !sheet.p.admin_role && (
              <Button size="lg" block variant="danger" onClick={() => setSheet({ kind: "delete", p: sheet.p })}>
                Delete account
              </Button>
            )}
            {!isOwner && <OwnerOnly>Owners can add staff and delete accounts.</OwnerOnly>}
          </div>
        </Sheet>
      )}
      {sheet?.kind === "rename" && (
        <ActionSheet
          title="Change nickname"
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
          title="Hide from leaderboards"
          description={<p>{sheet.p.display_name} disappears from every public board and the iPad. Their own stats stay visible to them.</p>}
          confirmLabel="Hide player"
          text={{ label: "Reason", required: false, placeholder: "e.g. Offensive nickname" }}
          onSubmit={async (_m, reason) => {
            await api.admin.moderatePlayer(sheet.p.id, "hide", null, reason);
            done(`${sheet.p.display_name} is hidden from leaderboards`);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "role" && (
        <ConfirmSheet
          title={sheet.role ? `Make ${sheet.p.display_name} ${sheet.role === "owner" ? "an owner" : "staff"}?` : "Remove staff access?"}
          body={
            sheet.role === "owner" ? (
              <p>Owners can do everything staff can, plus change settings and rewards, manage staff and delete accounts.</p>
            ) : sheet.role === "staff" ? (
              <p>Staff can fix sessions, manage players and crews, check SPINDEX ratings and see stats.</p>
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
