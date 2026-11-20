import { useCallback, useEffect, useState } from "react";
import LogoLoader from "../components/LogoLoader";
import CrewBadge, { EMBLEMS } from "../components/CrewBadge";
import PlayerCardSheet from "../components/PlayerCardSheet";
import { Copy, Crown, MoreHorizontal, RefreshCw, Share2, Users } from "lucide-react";
import { api, errorText } from "../lib/api";
import { formatNumber } from "../lib/time";
import type { AvatarColor, CrewEmblem, CrewMember, CrewRow, MyCrew, Scope } from "../lib/types";
import { useApp } from "../state";
import {
  Avatar,
  Button,
  Chip,
  ConfirmSheet,
  Field,
  IconButton,
  InlineError,
  Sheet,
  useToast,
} from "../components/ui";

const CREW_COLORS: AvatarColor[] = ["pink", "white", "blue", "green", "orange", "purple"];

export function inviteLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

export default function Crew() {
  const { me, refresh, bump, version } = useApp();
  const scope: Scope = me.settings.default_board_scope;
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
        <LogoLoader label="Loading crew" />
      </div>
    );
  return crew ? <CrewView crew={crew} onChanged={changed} /> : <NoCrew onChanged={changed} />;
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
      window.scrollTo({ top: 0 });
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
          Team up with {me.settings.crew_min_size}–{me.settings.crew_max_size} friends and add your minutes together.
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
          <LogoLoader label="Loading crews" />
        ) : top.length === 0 ? (
          <div className="list empty-row">No crews on the board yet this week.</div>
        ) : (
          <div className="list">
            {top.map((c) => (
              <div key={c.crew_id} className="rank-row">
                <span className="rank-num num">{c.rank}</span>
                <CrewBadge emblem={c.emblem} color={c.color} size={38} />
                <span className="rank-name">
                  <strong>{c.name}</strong>
                  <span>{c.motto || `${c.members} members`}</span>
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

function CrewView({ crew, onChanged }: { crew: MyCrew; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [manage, setManage] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [member, setMember] = useState<CrewMember | null>(null);
  const [profile, setProfile] = useState<CrewMember | null>(null);
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
        <div className="crew-title">
          <CrewBadge emblem={crew.emblem} color={crew.color} size={56} />
          <div style={{ minWidth: 0 }}>
            <h1>{crew.name}</h1>
            {crew.motto && <p className="crew-motto">{crew.motto}</p>}
          </div>
        </div>
        {crew.hidden_by_admin && <Chip tone="warn">Hidden from public boards by staff</Chip>}
        <div className="stat-strip three">
          <div className="stat-cell">
            <span className="stat-label">Rank</span>
            <span className={`stat-value num ${crew.rank ? "pink" : ""}`}>
              {crew.rank ? `#${crew.rank}` : "—"}
              {crew.rank ? <small>of {crew.crews_ranked}</small> : null}
            </span>
          </div>
          <div className="stat-cell">
            <span className="stat-label">This week</span>
            <span className="stat-value num">
              {formatNumber(crew.total_minutes)}
              <small>min</small>
            </span>
          </div>
          <div className="stat-cell">
            <span className="stat-label">Per member</span>
            <span className="stat-value num">
              {formatNumber(avg)}
              <small>min</small>
            </span>
          </div>
        </div>
        <p className="small-print">Crew minutes count play from when each member joined.</p>
        {needed > 0 && (
          <div className="invite-banner">
            <Users size={20} aria-hidden />
            <span>
              Add {needed} more {needed === 1 ? "player" : "players"} to get on the crew leaderboard.
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
          {crew.members.length} of {crew.max_members} spots filled
        </span>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Members</h2>
          <span className="small-print">This week</span>
        </div>
        <div className="list">
          {[...crew.members]
            .sort((a, b) => b.minutes - a.minutes)
            .map((m) => (
              <div
                key={m.user_id}
                className={`member-row tappable ${m.is_me ? "me" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`Open ${m.display_name}'s profile`}
                onClick={() => setProfile(m)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setProfile(m)}
              >
                <Avatar name={m.display_name} color={m.avatar_color} path={m.avatar_path} size={42} />
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
                    <IconButton
                      label={`Options for ${m.display_name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMember(m);
                      }}
                    >
                      <MoreHorizontal size={20} />
                    </IconButton>
                  )}
                </span>
              </div>
            ))}
        </div>
      </section>

      <Button variant="ghost" onClick={() => setLeaving(true)}>
        Leave crew
      </Button>

      {manage && <ManageSheet crew={crew} onClose={() => setManage(false)} onChanged={onChanged} />}
      {member && <MemberSheet member={member} onClose={() => setMember(null)} onChanged={onChanged} />}
      {profile && <PlayerCardSheet userId={profile.user_id} name={profile.display_name} onClose={() => setProfile(null)} />}
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
  const [color, setColor] = useState<AvatarColor>(crew.color ?? "pink");
  const [emblem, setEmblem] = useState<CrewEmblem>(crew.emblem ?? "users");
  const [motto, setMotto] = useState(crew.motto ?? "");
  const [busy, setBusy] = useState<"" | "save" | "code">("");
  const [error, setError] = useState("");
  const nameChanged = name.trim() !== crew.name;
  const lookChanged = color !== (crew.color ?? "pink") || emblem !== (crew.emblem ?? "users") || motto.trim() !== (crew.motto ?? "");
  const nameOk = name.trim().length >= 3;

  // One Save for everything on this sheet: name and look go together, so nothing gets lost.
  async function save() {
    setBusy("save");
    setError("");
    try {
      if (nameChanged) await api.renameCrew(name);
      if (lookChanged) await api.setCrewStyle({ color, emblem, motto });
      toast("Crew saved.");
      await onChanged();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }
  async function newCode() {
    setBusy("code");
    setError("");
    try {
      await api.regenerateCrewCode();
      toast("New invite code ready. The old one no longer works.");
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
          if ((nameChanged || lookChanged) && nameOk) void save();
        }}
      >
        <div className="crew-look-preview">
          <CrewBadge emblem={emblem} color={color} size={56} />
          <div style={{ minWidth: 0 }}>
            <strong>{name.trim() || crew.name}</strong>
            {motto.trim() && <span>{motto.trim()}</span>}
          </div>
        </div>
        <Field label="Crew name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
        <span className="label">Color</span>
        <div className="swatches" role="radiogroup" aria-label="Crew color">
          {CREW_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className={`swatch avatar-${c} ${color === c ? "on" : ""}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <span className="label">Emblem</span>
        <div className="emblem-grid" role="radiogroup" aria-label="Crew emblem">
          {EMBLEMS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={emblem === value}
              aria-label={label}
              className={`emblem-pick ${emblem === value ? "on" : ""}`}
              onClick={() => setEmblem(value)}
            >
              <Icon size={22} />
            </button>
          ))}
        </div>
        <Field label="Motto" maxLength={60} placeholder="Optional · e.g. Every Tuesday" value={motto} onChange={(e) => setMotto(e.target.value)} />
        <Button type="submit" variant="primary" size="lg" block loading={busy === "save"} disabled={!(nameChanged || lookChanged) || !nameOk}>
          Save changes
        </Button>
      </form>
      <div className="stack-sm">
        <span className="label">Invite code</span>
        <p className="small-print">The old code stops working. Members stay in.</p>
        <Button variant="secondary" block icon={<RefreshCw size={16} />} loading={busy === "code"} onClick={() => void newCode()}>
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
