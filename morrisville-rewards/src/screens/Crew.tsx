import { useCallback, useEffect, useState } from "react";
import { Copy, Crown, MoreHorizontal, RefreshCw, Share2, Users } from "lucide-react";
import { api, errorText } from "../lib/api";
import { formatNumber } from "../lib/time";
import type { CrewMember, CrewRow, MyCrew, Scope } from "../lib/types";
import { useApp } from "../state";
import {
  Avatar,
  Button,
  Chip,
  ConfirmSheet,
  Field,
  IconButton,
  InlineError,
  Segmented,
  Sheet,
  Skeleton,
  useToast,
} from "../components/ui";
import { scopeNote } from "./Rankings";

export function inviteLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

export default function Crew() {
  const { me, refresh, bump, version } = useApp();
  const [scope, setScope] = useState<Scope>(me.settings.default_board_scope);
  const [crew, setCrew] = useState<MyCrew | null | undefined>(undefined);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setCrew(await api.myCrew("week", scope));
    } catch (err) {
      setError(errorText(err));
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load, version, me.crew?.id]);

  const changed = async () => {
    await refresh();
    bump();
    await load();
  };

  if (error)
    return (
      <div className="page">
        <InlineError onRetry={() => void load()}>{error}</InlineError>
      </div>
    );
  if (crew === undefined)
    return (
      <div className="page">
        <Skeleton count={4} height={88} />
      </div>
    );
  return crew ? <CrewView crew={crew} scope={scope} setScope={setScope} onChanged={changed} /> : <NoCrew onChanged={changed} />;
}

function NoCrew({ onChanged }: { onChanged: () => Promise<void> }) {
  const { me } = useApp();
  const toast = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"" | "create" | "join">("");
  const [error, setError] = useState("");
  const [top, setTop] = useState<CrewRow[] | null>(null);

  useEffect(() => {
    void api
      .crewLeaderboard("week", me.settings.default_board_scope, 5)
      .then(setTop)
      .catch(() => setTop([]));
  }, [me.settings.default_board_scope]);

  async function run(kind: "create" | "join") {
    setBusy(kind);
    setError("");
    try {
      if (kind === "create") await api.createCrew(name);
      else await api.joinCrew(code);
      toast(kind === "create" ? "Crew created. Invite your friends." : "You joined the crew!");
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page">
      <div className="page-title">
        <h1>Crews</h1>
        <p>
          Team up with {me.settings.crew_min_size}–{me.settings.crew_max_size} friends. Every member's minutes add to the crew total.
        </p>
      </div>

      {error && <InlineError>{error}</InlineError>}

      <section className="panel stack">
        <h2 style={{ fontSize: 24 }}>Join a crew</h2>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run("join");
          }}
        >
          <Field
            label="Invite code"
            className="code-input"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={10}
            placeholder="ABCD2345"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            hint="Got a link from a friend? Just open it."
          />
          <Button type="submit" variant="primary" size="lg" block loading={busy === "join"} disabled={code.length < 6}>
            Join crew
          </Button>
        </form>
      </section>

      <section className="panel stack">
        <h2 style={{ fontSize: 24 }}>Start a crew</h2>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run("create");
          }}
        >
          <Field
            label="Crew name"
            maxLength={24}
            autoCapitalize="words"
            placeholder="e.g. Net Ninjas"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="3–24 characters. You can rename it later."
          />
          <Button type="submit" variant="secondary" size="lg" block loading={busy === "create"} disabled={name.trim().length < 3}>
            Create crew
          </Button>
        </form>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Top crews this week</h2>
        </div>
        {top === null ? (
          <Skeleton count={3} height={60} />
        ) : top.length === 0 ? (
          <div className="panel small-print">No crews have ranked yet this week. Yours could be first.</div>
        ) : (
          <div className="list">
            {top.map((c) => (
              <div key={c.crew_id} className="rank-row">
                <span className="rank-num num">{c.rank}</span>
                <span className="crew-badge">
                  <Users size={18} />
                </span>
                <span className="rank-name">
                  <strong>{c.name}</strong>
                  <span>{c.members} members</span>
                </span>
                <span className="rank-value num">
                  {formatNumber(c.minutes)}
                  <small>min</small>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CrewView({
  crew,
  scope,
  setScope,
  onChanged,
}: {
  crew: MyCrew;
  scope: Scope;
  setScope: (s: Scope) => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [manage, setManage] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [member, setMember] = useState<CrewMember | null>(null);
  const needed = Math.max(0, crew.min_members - crew.members.length);
  const avg = crew.members.length ? Math.round(crew.total_minutes / crew.members.length) : 0;
  const link = inviteLink(crew.invite_code);

  async function share() {
    const text = `Join my crew "${crew.name}" on PingPod Morrisville Rewards`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "PingPod Morrisville crew invite", text, url: link });
        return;
      } catch {
        /* cancelled — fall back to copy */
      }
    }
    await copy(link, "Invite link copied");
  }
  async function copy(value: string, msg: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(msg);
    } catch {
      toast("Couldn't copy — press and hold the code to copy it.", "bad");
    }
  }

  return (
    <div className="page">
      <section className="crew-hero">
        <div className="section-head">
          <div className="eyebrow" style={{ color: "var(--pink)" }}>
            Your crew
          </div>
          {crew.is_owner && (
            <Button variant="ghost" size="sm" onClick={() => setManage(true)}>
              Manage
            </Button>
          )}
        </div>
        <h1>{crew.name}</h1>
        {crew.hidden_by_admin && <Chip tone="warn">Hidden from public boards by staff</Chip>}
        <Segmented<Scope>
          label="Which sessions count"
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "verified", label: "Verified" },
            { value: "community", label: "Community" },
          ]}
        />
        <div className="crew-kpis">
          <div className="stat">
            <span className="stat-label">Rank</span>
            <span className="stat-value num">{crew.rank ? `#${crew.rank}` : "—"}</span>
            <span className="stat-sub">{crew.rank ? `of ${crew.crews_ranked}` : "Not ranked"}</span>
          </div>
          <div className="stat">
            <span className="stat-label">This week</span>
            <span className="stat-value num">{formatNumber(crew.total_minutes)}</span>
            <span className="stat-sub">minutes</span>
          </div>
          <div className="stat">
            <span className="stat-label">Per member</span>
            <span className="stat-value num">{formatNumber(avg)}</span>
            <span className="stat-sub">minutes</span>
          </div>
        </div>
        <p className="small-print">{scopeNote(scope)}</p>
        {needed > 0 && (
          <div className="invite-banner">
            <Users size={20} aria-hidden />
            <span>
              Add {needed} more {needed === 1 ? "player" : "players"} to appear on the crew leaderboard.
            </span>
          </div>
        )}
      </section>

      <section className="panel invite-card">
        <div className="eyebrow">Invite friends</div>
        <div className="section-head" style={{ alignItems: "center" }}>
          <span className="invite-code num" aria-label={`Invite code ${crew.invite_code.split("").join(" ")}`}>
            {crew.invite_code}
          </span>
          <IconButton label="Copy invite code" onClick={() => void copy(crew.invite_code, "Code copied")}>
            <Copy size={20} />
          </IconButton>
        </div>
        <Button variant="primary" size="lg" block icon={<Share2 size={18} />} onClick={() => void share()}>
          Share invite link
        </Button>
        <span className="small-print">
          {crew.members.length}/{crew.max_members} members · friends can open the link or type the code on the Crew tab.
        </span>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Members</h2>
          <span className="small-print">Minutes this week</span>
        </div>
        <div className="list">
          {[...crew.members]
            .sort((a, b) => b.minutes - a.minutes)
            .map((m) => (
              <div key={m.user_id} className={`member-row ${m.is_me ? "me" : ""}`}>
                <Avatar name={m.display_name} color={m.avatar_color} size={40} />
                <span className="rank-name">
                  <strong>
                    {m.display_name} {m.is_me && <span className="you-tag">YOU</span>}
                  </strong>
                  <span>{m.is_owner ? <><Crown size={13} aria-hidden /> Owner</> : "Member"}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="rank-value num">
                    {formatNumber(m.minutes)}
                    <small>min</small>
                  </span>
                  {crew.is_owner && !m.is_me && (
                    <IconButton label={`Options for ${m.display_name}`} onClick={() => setMember(m)}>
                      <MoreHorizontal size={20} />
                    </IconButton>
                  )}
                </span>
              </div>
            ))}
        </div>
        <p className="small-print">Only play from after someone joined counts toward the crew.</p>
      </section>

      <Button variant="ghost" onClick={() => setLeaving(true)}>
        Leave crew
      </Button>

      {manage && <ManageSheet crew={crew} onClose={() => setManage(false)} onChanged={onChanged} />}
      {member && <MemberSheet member={member} onClose={() => setMember(null)} onChanged={onChanged} />}
      {leaving && (
        <ConfirmSheet
          title="Leave crew?"
          body={
            <p>
              {crew.is_owner && crew.members.length > 1
                ? "You're the owner, so the longest-standing member takes over. "
                : crew.members.length === 1
                  ? "You're the last member, so the crew will close. "
                  : ""}
              Your minutes so far stay with {crew.name}.
            </p>
          }
          confirmLabel="Leave crew"
          danger
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            await api.leaveCrew();
            toast("You left the crew.");
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function ManageSheet({ crew, onClose, onChanged }: { crew: MyCrew; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(crew.name);
  const [busy, setBusy] = useState<"" | "rename" | "code">("");
  const [error, setError] = useState("");
  async function run(kind: "rename" | "code") {
    setBusy(kind);
    setError("");
    try {
      if (kind === "rename") await api.renameCrew(name);
      else await api.regenerateCrewCode();
      toast(kind === "rename" ? "Crew renamed." : "New invite code ready. The old one no longer works.");
      await onChanged();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }
  return (
    <Sheet title="Manage crew" onClose={onClose}>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void run("rename");
        }}
      >
        <Field label="Crew name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" block loading={busy === "rename"} disabled={name.trim() === crew.name || name.trim().length < 3}>
          Save name
        </Button>
      </form>
      <div className="stack-sm">
        <span className="label">Invite code</span>
        <p className="small-print">Make a new code if the old one was shared too widely. Current members stay in.</p>
        <Button variant="secondary" block icon={<RefreshCw size={16} />} loading={busy === "code"} onClick={() => void run("code")}>
          Make a new invite code
        </Button>
      </div>
      {error && <InlineError>{error}</InlineError>}
    </Sheet>
  );
}

function MemberSheet({ member, onClose, onChanged }: { member: CrewMember; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<"" | "owner" | "remove">("");
  if (confirm)
    return (
      <ConfirmSheet
        title={confirm === "owner" ? `Make ${member.display_name} the owner?` : `Remove ${member.display_name}?`}
        body={
          <p>
            {confirm === "owner"
              ? "They'll be able to rename the crew, change the invite code, and manage members. You'll stay in the crew."
              : "Their minutes so far stay with the crew. They can rejoin with an invite code."}
          </p>
        }
        confirmLabel={confirm === "owner" ? "Make owner" : "Remove from crew"}
        danger={confirm === "remove"}
        onClose={onClose}
        onConfirm={async () => {
          if (confirm === "owner") await api.transferCrew(member.user_id);
          else await api.removeCrewMember(member.user_id);
          toast(confirm === "owner" ? "Ownership transferred." : "Member removed.");
          await onChanged();
        }}
      />
    );
  return (
    <Sheet title={member.display_name} onClose={onClose}>
      <div className="stack-sm">
        <Button variant="secondary" size="lg" block icon={<Crown size={18} />} onClick={() => setConfirm("owner")}>
          Make crew owner
        </Button>
        <Button variant="danger" size="lg" block onClick={() => setConfirm("remove")}>
          Remove from crew
        </Button>
      </div>
    </Sheet>
  );
}
