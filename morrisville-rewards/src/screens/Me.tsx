import { useCallback, useEffect, useState } from "react";
import LogoLoader from "../components/LogoLoader";
import PhotoCropper from "../components/PhotoCropper";
import {
  Award,
  CalendarCheck,
  Camera,
  ChevronRight,
  CircleHelp,
  Clock,
  Crown,
  ExternalLink,
  Flame,
  Hourglass,
  KeyRound,
  LogOut,
  Medal,
  Play,
  ShieldCheck,
  Star,
  Trash2,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api, errorText } from "../lib/api";
import { Link } from "../lib/router";
import { formatDateTime, formatDay, formatDuration, formatNumber, formatTime } from "../lib/time";
import type { Achievement, AvatarColor, PlaySession, SupportRequest } from "../lib/types";
import { useApp } from "../state";
import {
  Avatar,
  Button,
  Chip,
  ConfirmSheet,
  Field,
  InlineError,
  ProgressBar,
  Sheet,
  StatusChip,
  Toggle,
  useToast,
} from "../components/ui";
import { ColorPicker, nicknameProblem } from "./Onboarding";
import { SessionRow } from "./Home";

export default function MeScreen() {
  const { me, refresh, signOut, version, bump, showTutorial } = useApp();
  const toast = useToast();
  const p = me.profile!;
  const s = me.stats!;
  const [editing, setEditing] = useState(false);
  const [pw, setPw] = useState(false);
  const [del, setDel] = useState(false);
  const [saving, setSaving] = useState("");

  async function setPrivacy(patch: { show_on_leaderboard?: boolean; show_spindex?: boolean }) {
    const key = Object.keys(patch)[0];
    setSaving(key);
    try {
      await api.saveProfile({
        display_name: p.display_name,
        avatar_color: p.avatar_color,
        show_on_leaderboard: patch.show_on_leaderboard ?? p.show_on_leaderboard,
        show_spindex: patch.show_spindex ?? p.show_spindex,
      });
      await refresh();
      bump();
      toast("Privacy updated.");
    } catch (err) {
      toast(errorText(err), "bad");
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="page">
      <section className="profile-head">
        <button type="button" className="profile-photo" onClick={() => setEditing(true)} aria-label="Change photo">
          <Avatar name={p.display_name} color={p.avatar_color} path={p.avatar_path} size={72} />
        </button>
        <div style={{ minWidth: 0 }}>
          <h1>{p.display_name}</h1>
          {p.bio && <p className="profile-bio">{p.bio}</p>}
          <div className="profile-chips">
            {p.hidden_by_admin ? (
              <Chip tone="warn">Hidden by staff</Chip>
            ) : p.show_on_leaderboard ? (
              <Chip tone="ok">On leaderboards</Chip>
            ) : (
              <Chip>Private</Chip>
            )}
            {p.email_verified_at && <Chip tone="ok">Email verified</Chip>}
            {me.crew && (
              <Link to="/crew" className="chip chip-crew">
                {me.crew.name}
              </Link>
            )}
          </div>
        </div>
        <Button variant="secondary" size="sm" className="profile-edit" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </section>

      <section className="stat-strip six" aria-label="Your totals">
        <div className="stat-cell">
          <span className="stat-label">Total</span>
          <span className="stat-value num">
            {formatNumber(s.total_verified + s.total_pending)}
            <small>min</small>
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">This week</span>
          <span className="stat-value num">
            {formatNumber(s.week_verified + s.week_pending)}
            <small>min</small>
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Sessions</span>
          <span className="stat-value num">{s.sessions}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Longest</span>
          <span className="stat-value num">
            {s.longest_session}
            <small>min</small>
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Streak</span>
          <span className="stat-value num">
            {s.current_streak}
            <small>{s.current_streak === 1 ? "day" : "days"}</small>
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Best streak</span>
          <span className="stat-value num">
            {s.longest_streak}
            <small>{s.longest_streak === 1 ? "day" : "days"}</small>
          </span>
        </div>
      </section>

      <Achievements version={version} />
      <History version={version} />
      <Requests version={version} />

      <section className="section">
        <div className="section-head">
          <h2>Privacy</h2>
        </div>
        <div className="list settings-list">
          <Toggle
            checked={p.show_on_leaderboard}
            disabled={saving !== ""}
            onChange={(v) => void setPrivacy({ show_on_leaderboard: v })}
            label="Show me on leaderboards"
            description="Your nickname and stats in the app and on the in-store screen. Your email is never shown."
          />
          <Toggle
            checked={p.show_spindex}
            disabled={saving !== ""}
            onChange={(v) => void setPrivacy({ show_spindex: v })}
            label="Show my SPINDEX rating"
            description="On the SPINDEX board, if you've added one."
          />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Account</h2>
        </div>
        <div className="list settings-list">
          {(me.admin_role || me.staff_needs_password) && (
            <Link to="/admin" className="settings-link">
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <ShieldCheck size={18} style={{ color: "var(--pink)" }} /> Staff dashboard
              </span>
              <ChevronRight size={18} />
            </Link>
          )}
          {me.admin_role && (
            <button className="settings-link" onClick={() => setPw(true)}>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <KeyRound size={18} /> Change staff password
              </span>
              <ChevronRight size={18} />
            </button>
          )}
          <button className="settings-link" onClick={showTutorial}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <CircleHelp size={18} /> How it works
            </span>
            <ChevronRight size={18} />
          </button>
          {me.settings.survey_url && (
            <a className="settings-link" href={me.settings.survey_url} target="_blank" rel="noopener noreferrer">
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <ExternalLink size={18} /> Research survey
              </span>
              <ChevronRight size={18} />
            </a>
          )}
          <button className="settings-link" onClick={() => void signOut()}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <LogOut size={18} /> Sign out
            </span>
          </button>
          <button className="settings-link danger" onClick={() => setDel(true)}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Trash2 size={18} /> Delete account
            </span>
          </button>
        </div>
      </section>

      <footer className="app-foot">
        A PingPod Morrisville pilot, separate from the PingPod app and booking.
      </footer>

      {editing && <EditProfileSheet onClose={() => setEditing(false)} />}
      {pw && <PasswordSheet onClose={() => setPw(false)} />}
      {del && <DeleteSheet onClose={() => setDel(false)} />}
    </div>
  );
}

function EditProfileSheet({ onClose }: { onClose: () => void }) {
  const { me, refresh, bump } = useApp();
  const toast = useToast();
  const p = me.profile!;
  const [name, setName] = useState(p.display_name);
  const [color, setColor] = useState<AvatarColor>(p.avatar_color);
  const [bio, setBio] = useState(p.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const [error, setError] = useState("");
  const problem = nicknameProblem(name);

  async function savePhoto(photo: Blob) {
    setPhotoBusy(true);
    setError("");
    try {
      await api.uploadAvatar(photo);
      await refresh();
      bump();
      setCropping(null);
      toast("Photo updated.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPhotoBusy(false);
    }
  }
  async function dropPhoto() {
    setPhotoBusy(true);
    setError("");
    try {
      await api.removeAvatar();
      await refresh();
      bump();
      toast("Photo removed.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  if (cropping)
    return (
      <Sheet title="Crop photo" onClose={() => setCropping(null)}>
        <PhotoCropper file={cropping} busy={photoBusy} onCancel={() => setCropping(null)} onConfirm={(b) => void savePhoto(b)} />
        {error && <InlineError>{error}</InlineError>}
      </Sheet>
    );

  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <div className="photo-edit">
        <span className="photo-edit-avatar">
          <Avatar name={name || p.display_name} color={color} path={p.avatar_path} size={88} />
          {photoBusy && <span className="photo-edit-busy"><LogoLoader size={18} label="Saving photo" /></span>}
        </span>
        <div className="photo-edit-actions">
          <label className={`btn btn-secondary btn-md ${photoBusy ? "is-disabled" : ""}`}>
            <Camera size={16} aria-hidden /> {p.avatar_path ? "Change photo" : "Add a photo"}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={photoBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setError("");
                  setCropping(f);
                }
                e.target.value = "";
              }}
            />
          </label>
          {p.avatar_path && (
            <button type="button" className="link-btn" disabled={photoBusy} onClick={() => void dropPhoto()}>
              Remove photo
            </button>
          )}
        </div>
      </div>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (problem) return setError(problem);
          setBusy(true);
          setError("");
          try {
            await api.saveProfile({
              display_name: name.trim().replace(/\s+/g, " "),
              avatar_color: color,
              show_on_leaderboard: p.show_on_leaderboard,
              show_spindex: p.show_spindex,
            });
            if (bio.trim() !== (p.bio ?? "")) await api.saveBio(bio);
            await refresh();
            bump();
            toast("Profile saved.");
            onClose();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Nickname" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} error={name && problem ? problem : undefined} />
        <div className="stack-sm">
          <label className="label" htmlFor="bio">
            Bio
          </label>
          <textarea
            id="bio"
            className="input"
            rows={2}
            maxLength={140}
            placeholder="Optional · e.g. Backhand loops, Tuesday nights"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>
        <div className="stack-sm">
          <span className="label">Color</span>
          <ColorPicker value={color} onChange={setColor} name={name} />
        </div>
        {error && <InlineError>{error}</InlineError>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

// Each milestone gets its own icon so the list doesn't read as one repeated ribbon.
const BADGE_ICON: Record<string, LucideIcon> = {
  first_session: Play,
  first_hour: Clock,
  minutes_300: Medal,
  minutes_600: Star,
  minutes_1200: Crown,
  long_session: Hourglass,
  streak_3: Flame,
  streak_7: Flame,
  crew_joined: Users,
  regular: CalendarCheck,
  weekly_top5: Trophy,
};

const BADGE_ORDER = (a: Achievement, b: Achievement) =>
  Number(Boolean(b.earned_at)) - Number(Boolean(a.earned_at)) || b.progress / b.target - a.progress / a.target;

function Achievements({ version }: { version: number }) {
  const [items, setItems] = useState<Achievement[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    void api
      .achievements()
      .then(setItems)
      .catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load, version]);
  const [all, setAll] = useState(false);
  const earned = items?.filter((a) => a.earned_at).length ?? 0;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Milestones</h2>
        {items && (
          <span className="small-print">
            {earned} of {items.length} earned
          </span>
        )}
      </div>
      {error ? (
        <InlineError onRetry={load}>{error}</InlineError>
      ) : !items ? (
        <LogoLoader label="Loading milestones" />
      ) : (
        <div className="badges">
          {[...items]
            .sort(BADGE_ORDER)
            .slice(0, all ? items.length : 4)
            .map((a) => (
            <div key={a.code} className={`badge ${a.earned_at ? "earned" : ""}`}>
              <span className="badge-icon">
                {(() => {
                  const Icon = BADGE_ICON[a.code] ?? Award;
                  return <Icon size={20} />;
                })()}
              </span>
              <span className="badge-text">
                <strong>{a.title}</strong>
                <span>{a.earned_at ? `Earned ${new Date(a.earned_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}` : a.description}</span>
                {!a.earned_at && a.target > 1 && (
                  <>
                    <ProgressBar value={a.progress} max={a.target} label={a.title} />
                    <span>
                      {formatNumber(a.progress)}/{formatNumber(a.target)}
                    </span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {items && items.length > 4 && (
        <button type="button" className="link-btn quiet" onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

function History({ version }: { version: number }) {
  const [rows, setRows] = useState<PlaySession[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<PlaySession | null>(null);
  const [limit, setLimit] = useState(15);
  const load = useCallback(() => {
    setError("");
    void api
      .mySessions(limit + 6)
      .then((all) => setRows(all.filter((s) => s.status !== "cancelled")))
      .catch((err) => setError(errorText(err)));
  }, [limit]);
  useEffect(load, [load, version]);
  // Arrived from Home ("History" or a recent session): scroll here, and open that session.
  useEffect(() => {
    const hash = window.location.hash;
    if (!rows || !(hash === "#history" || hash.startsWith("#session-"))) return;
    let tries = 0;
    let t = 0;
    const go = () => {
      const el = document.getElementById("history");
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        const hit = hash.startsWith("#session-") ? rows.find((r) => r.id === hash.slice(9)) : undefined;
        if (hit) setOpen(hit);
        window.history.replaceState(null, "", window.location.pathname);
      } else if (tries++ < 15) t = window.setTimeout(go, 150);
    };
    t = window.setTimeout(go, 50);
    return () => window.clearTimeout(t);
  }, [rows]);
  return (
    <section className="section" id="history">
      <div className="section-head">
        <h2>History</h2>
      </div>
      {error ? (
        <InlineError onRetry={load}>{error}</InlineError>
      ) : !rows ? (
        <LogoLoader label="Loading history" />
      ) : rows.length === 0 ? (
        <div className="list empty-row">No sessions yet.</div>
      ) : (
        <>
          <div className="list">
            {rows.slice(0, limit).map((s) => (
              <SessionRow key={s.id} s={s} onClick={() => setOpen(s)} />
            ))}
          </div>
          {rows.length > limit && (
            <Button variant="ghost" onClick={() => setLimit((l) => l + 30)}>
              Show more
            </Button>
          )}
        </>
      )}
      {open && <SessionSheet s={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function SessionSheet({ s, onClose }: { s: PlaySession; onClose: () => void }) {
  const toast = useToast();
  const { bump, refresh } = useApp();
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title={formatDay(s.played_on)} onClose={onClose}>
      <div className="stack-sm">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span className="result-min num" style={{ fontSize: 56 }}>
            {s.minutes}
            <small>min</small>
          </span>
          <StatusChip status={s.status} />
        </div>
        <p className="small-print">
          {s.method === "timer"
            ? s.ended_at
              ? `Timer · ${formatTime(s.started_at)} – ${formatTime(s.ended_at)}`
              : "Timer"
            : `Logged ${formatDateTime(s.created_at)}`}
          {s.submitted_minutes != null && s.submitted_minutes !== s.minutes && ` · you submitted ${formatDuration(s.submitted_minutes)}`}
        </p>
        {s.auto_closed && <p className="small-print">This timer ran to the limit and was stopped automatically.</p>}
        {s.note && <p>“{s.note}”</p>}
        {s.review_reason && (s.status === "rejected" || s.status === "approved") && (
          <p className="staff-reply">Staff note: {s.review_reason}</p>
        )}
        {s.status === "pending" && <p className="small-print">Staff are taking a look at this one.</p>}
      </div>
      {asking ? (
        <form
          className="stack-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.submitRequest("correction", msg, s.id);
              toast("Request sent to staff.");
              bump();
              onClose();
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          <label className="label" htmlFor="fix-msg">
            What should change?
          </label>
          <textarea
            id="fix-msg"
            className="input"
            maxLength={600}
            rows={3}
            placeholder="e.g. I played 90 minutes, not 60."
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" block loading={busy} disabled={msg.trim().length < 3}>
            Send to staff
          </Button>
        </form>
      ) : (
        s.status !== "cancelled" && (
          <div className="stack-sm">
            <Button variant="secondary" block onClick={() => setAsking(true)}>
              Request a correction
            </Button>
            <button type="button" className="link-btn quiet" onClick={() => setRemoving(true)}>
              Remove this session
            </button>
          </div>
        )
      )}
      {removing && (
        <ConfirmSheet
          title="Remove this session?"
          body={<p>These {s.minutes} minutes stop counting on the leaderboard, your streak and your crew.</p>}
          confirmLabel="Remove session"
          danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await api.removeSession(s.id);
            toast("Session removed.");
            await refresh();
            bump();
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

function Requests({ version }: { version: number }) {
  const [rows, setRows] = useState<SupportRequest[]>([]);
  useEffect(() => {
    void api
      .myRequests()
      .then(setRows)
      .catch(() => setRows([]));
  }, [version]);
  if (!rows.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Your requests</h2>
      </div>
      <div className="list">
        {rows.slice(0, 5).map((r) => (
          <div key={r.id} className="request-row">
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ textTransform: "capitalize" }}>{r.kind}</strong>
              <Chip tone={r.status === "open" ? "warn" : r.status === "resolved" ? "ok" : "neutral"}>
                {r.status === "open" ? "Waiting for staff" : r.status === "resolved" ? "Resolved" : "Closed"}
              </Chip>
            </span>
            <p>{r.message}</p>
            {r.admin_response && <p className="staff-reply">{r.admin_response}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title="Change staff password" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return setError("Use at least 8 characters.");
          setBusy(true);
          setError("");
          try {
            await api.updatePassword(pw);
            toast("Password updated.");
            onClose();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="At least 8 characters. Staff accounts sign in with email and password." />
        {error && <InlineError>{error}</InlineError>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Save password
        </Button>
      </form>
    </Sheet>
  );
}

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title="Delete account?" onClose={onClose}>
      <div className="sheet-text">
        <p>This permanently deletes your account, sessions, crew membership and SPINDEX rating. It can't be undone.</p>
        <p>Your minutes will also disappear from crew and leaderboard totals.</p>
      </div>
      <Field label='Type "DELETE" to confirm' autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />
      {error && <InlineError>{error}</InlineError>}
      <Button
        variant="danger"
        size="lg"
        block
        loading={busy}
        disabled={typed.trim().toUpperCase() !== "DELETE"}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api.deleteAccount();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        Delete my account
      </Button>
      <Button variant="ghost" block onClick={onClose}>
        Keep my account
      </Button>
    </Sheet>
  );
}
