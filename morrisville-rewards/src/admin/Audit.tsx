import { ScrollText } from "lucide-react";
import { api } from "../lib/api";
import type { AuditEntry } from "../lib/types";
import { EmptyState, InlineError } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { formatDateTime } from "../lib/time";
import { SectionHead, useLoad } from "./shared";

const ACTIONS: Record<string, string> = {
  "session.approve": "Approved a session",
  "session.reject": "Removed a session",
  "session.adjust": "Fixed minutes",
  "session.reopen": "Reopened a session",
  "session.bulk_approve": "Approved sessions",
  "player.hide": "Hid a player from leaderboards",
  "player.unhide": "Put a player back on leaderboards",
  "player.rename": "Changed a nickname",
  "account.deleted_by_staff": "Deleted an account",
  "account.deleted_by_player": "Player deleted their own account",
  "crew.rename": "Renamed a crew",
  "crew.hide": "Hid a crew from leaderboards",
  "crew.unhide": "Put a crew back on leaderboards",
  "crew.archive": "Closed a crew",
  "crew.transfer": "Changed a crew's owner",
  "crew.remove_member": "Removed a crew member",
  "spindex.verify": "Verified a SPINDEX rating",
  "spindex.reject": "Declined a SPINDEX rating",
  "spindex.unverify": "Undid a SPINDEX verification",
  "request.resolved": "Resolved a request",
  "request.dismissed": "Closed a request",
  "request.open": "Reopened a request",
  "settings.update": "Changed settings",
  "reward.save": "Saved a reward",
  "staff.set": "Changed staff access",
  "staff.claimed": "Unlocked staff tools with a code",
};

const STATUS_WORDS: Record<string, string> = { approved: "counted", pending: "waiting", rejected: "removed", cancelled: "not counted" };
const SETTING_WORDS: Record<string, string> = {
  pilot_start: "pilot start",
  pilot_end: "pilot end",
  max_session_minutes: "timer limit",
  checkin_reminder_minutes: "check-in reminder",
  manual_min_minutes: "shortest session",
  manual_max_minutes: "longest logged session",
  backdate_days: "backdating",
  daily_minutes_cap: "daily limit",
  crew_min_size: "crew minimum",
  crew_max_size: "crew size",
  display_rotation_seconds: "iPad timing",
  display_slides: "iPad screens",
  boards_enabled: "leaderboards",
  rewards_enabled: "rewards switch",
  public_app_url: "QR address",
  venue_name: "venue name",
};

function summarize(e: AuditEntry): string {
  const d = e.details ?? {};
  const parts: string[] = [];
  const before = d.before as { status?: string; minutes?: number } | undefined;
  const after = d.after as { status?: string; minutes?: number } | undefined;
  if (before && after) {
    if (before.minutes !== after.minutes) parts.push(`${before.minutes} → ${after.minutes} min`);
    if (before.status !== after.status)
      parts.push(`${STATUS_WORDS[before.status ?? ""] ?? before.status} → ${STATUS_WORDS[after.status ?? ""] ?? after.status}`);
  }
  if (typeof d.count === "number") parts.push(`${d.count} sessions`);
  if (typeof d.rating === "number") parts.push(`rating ${d.rating}`);
  if (e.action === "staff.set" || e.action === "staff.claimed") parts.push(d.role ? (d.role === "owner" ? "owner" : "staff") : "access removed");
  if (typeof d.value === "string" && e.action.endsWith("rename")) parts.push(`→ “${d.value}”`);
  if (e.action === "settings.update") parts.push(Object.keys(d).map((k) => SETTING_WORDS[k] ?? k.replace(/_/g, " ")).join(", "));
  if (e.action === "reward.save" && typeof d.title === "string") parts.push(`${d.title}${d.enabled ? " (on)" : " (off)"}`);
  const reason = (d.reason ?? d.source ?? d.response) as string | null | undefined;
  if (reason) parts.push(`“${reason}”`);
  return parts.join(" · ");
}

export default function Audit() {
  const { data, error, loading, reload } = useLoad(() => api.admin.audit(200), []);
  return (
    <section className="adm-section">
      <SectionHead title="Activity log" sub="Changes made by staff, newest first." />
      {loading && !data ? (
        <LogoLoader label="Loading activity" />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState icon={<ScrollText />} title="Nothing yet" text="Fixes, removals and other staff changes show up here." />
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
