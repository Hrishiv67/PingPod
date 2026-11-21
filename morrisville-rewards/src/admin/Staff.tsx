import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import type { StaffMember, StaffRole } from "../lib/types";
import { Avatar, Button, Chip, ConfirmSheet, EmptyState, InlineError, useToast } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { formatDateTime } from "../lib/time";
import { OwnerOnly, SectionHead, useLoad } from "./shared";

export default function Staff({ isOwner, myId }: { isOwner: boolean; myId: string }) {
  const { data, error, loading, reload } = useLoad(() => api.admin.staff(), []);
  const [pending, setPending] = useState<{ m: StaffMember; role: StaffRole | null } | null>(null);
  const toast = useToast();

  return (
    <section className="adm-section">
      <SectionHead title="Staff" sub="People who can open this dashboard." />
      <p className="adm-small adm-muted">
        To add someone, ask them to sign up in the app first, then find their nickname in <b>Players</b> and choose Make staff or Make
        owner. Owners can also change settings, rewards, staff and delete accounts.
      </p>
      {!isOwner && <OwnerOnly>Only an owner can change staff access.</OwnerOnly>}
      {loading && !data ? (
        <LogoLoader label="Loading staff" />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState icon={<ShieldCheck />} title="No staff yet" />
      ) : (
        <ul className="adm-list">
          {data.map((m) => {
            const self = m.user_id === myId;
            return (
              <li key={m.user_id} className="adm-card">
                <div className="adm-card-top">
                  <Avatar name={m.display_name ?? "?"} size={36} />
                  <div className="adm-card-title">
                    <strong>
                      {m.display_name ?? "No nickname yet"}
                      {self && <span className="adm-muted"> (you)</span>}
                    </strong>
                    <span className="adm-email">{m.email ?? "—"}</span>
                  </div>
                  <Chip tone="pink">{m.role === "owner" ? "Owner" : "Staff"}</Chip>
                </div>
                <p className="adm-small adm-muted">Since {formatDateTime(m.added_at)}</p>
                {isOwner && !self && (
                  <div className="adm-actions">
                    <Button size="sm" variant="ghost" onClick={() => setPending({ m, role: m.role === "owner" ? "staff" : "owner" })}>
                      {m.role === "owner" ? "Make staff" : "Make owner"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setPending({ m, role: null })}>
                      Remove staff
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pending && (
        <ConfirmSheet
          title={pending.role ? `Make ${pending.m.display_name ?? "them"} ${pending.role === "owner" ? "an owner" : "staff"}?` : "Remove staff access?"}
          body={<p>{pending.role ? "Their access changes right away." : `${pending.m.display_name ?? "They"} will no longer be able to open this dashboard.`}</p>}
          confirmLabel={pending.role ? "Confirm" : "Remove access"}
          danger={!pending.role}
          onConfirm={async () => {
            await api.admin.setStaff(pending.m.user_id, pending.role);
            toast("Staff access updated");
            void reload();
          }}
          onClose={() => setPending(null)}
        />
      )}
    </section>
  );
}
