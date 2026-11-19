import { ScrollText } from "lucide-react";
import { api } from "../lib/api";
import type { AuditEntry } from "../lib/types";
import { EmptyState, InlineError, Skeleton } from "../components/ui";
import { formatDateTime } from "../lib/time";
import { SectionHead, useLoad } from "./shared";

const ACTIONS: Record<string, string> = {
  "session.approve": "Approved a session",
  "session.reject": "Rejected a session",
  "session.adjust": "Adjusted minutes",
  "session.reopen": "Reopened a session",
  "session.bulk_approve": "Approved sessions in bulk",
  "player.hide": "Hid a player from boards",
  "player.unhide": "Unhid a player",
  "player.rename": "Renamed a player",
  "account.deleted_by_staff": "Deleted an account",
  "account.deleted_by_player": "Player deleted their own account",
  "crew.rename": "Renamed a crew",
  "crew.hide": "Hid a crew",
  "crew.unhide": "Unhid a crew",
  "crew.archive": "Archived a crew",
  "crew.transfer": "Changed a crew's owner",
  "crew.remove_member": "Removed a crew member",
  "spindex.verify": "Verified a SPINDEX rating",
  "spindex.reject": "Rejected a SPINDEX rating",
  "spindex.unverify": "Undid a SPINDEX verification",
  "request.resolved": "Resolved a request",
  "request.dismissed": "Dismissed a request",
  "request.open": "Reopened a request",
  "settings.update": "Changed settings",
  "reward.save": "Saved a reward",
  "staff.set": "Changed staff access",
  "staff.claimed": "Claimed staff access with a code",
};

function summarize(e: AuditEntry): string {
  const d = e.details ?? {};
  const parts: string[] = [];
  const before = d.before as { status?: string; minutes?: number } | undefined;
  const after = d.after as { status?: string; minutes?: number } | undefined;
  if (before && after) {
    if (before.minutes !== after.minutes) parts.push(`${before.minutes} → ${after.minutes} min`);
    if (before.status !== after.status) parts.push(`${before.status} → ${after.status}`);
  }
  if (typeof d.count === "number") parts.push(`${d.count} sessions`);
  if (typeof d.rating === "number") parts.push(`rating ${d.rating}`);
  if (e.action === "staff.set" || e.action === "staff.claimed") parts.push(d.role ? `role: ${String(d.role)}` : "access removed");
  if (typeof d.value === "string" && e.action.endsWith("rename")) parts.push(`→ “${d.value}”`);
  if (e.action === "settings.update") parts.push(Object.keys(d).join(", "));
  if (e.action === "reward.save" && typeof d.title === "string") parts.push(`${d.title}${d.enabled ? " (on)" : " (off)"}`);
  const reason = (d.reason ?? d.source ?? d.response) as string | null | undefined;
  if (reason) parts.push(`“${reason}”`);
  return parts.join(" · ");
}

export default function Audit() {
  const { data, error, loading, reload } = useLoad(() => api.admin.audit(200), []);
  return (
    <section className="adm-section">
      <SectionHead title="Audit log" sub="Every staff decision, newest first (latest 200)." />
      {loading && !data ? (
        <Skeleton height={56} count={6} />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState icon={<ScrollText />} title="Nothing yet" text="Approvals, edits and moderation show up here." />
      ) : (
        <ol className="adm-audit">
          {data.map((e) => {
            const summary = summarize(e);
            return (
              <li key={e.id}>
                <div className="adm-audit-main">
                  <strong>{ACTIONS[e.action] ?? e.action}</strong>
                  {summary && <span>{summary}</span>}
                </div>
                <div className="adm-audit-meta">
                  <span>{e.actor_name ?? "System"}</span>
                  <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
