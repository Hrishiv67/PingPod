import { useCallback, useEffect, useState } from "react";
import { Award, ChevronRight, KeyRound, LogOut, ShieldCheck, Trash2 } from "lucide-react";
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
  Skeleton,
  StatusChip,
  Toggle,
  useToast,
} from "../components/ui";
import { ColorPicker, nicknameProblem } from "./Onboarding";
import { SessionRow } from "./Home";

export default function MeScreen() {
  const { me, refresh, signOut, version, bump } = useApp();
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
        <Avatar name={p.display_name} color={p.avatar_color} size={68} />
        <div style={{ minWidth: 0 }}>
          <h1>{p.display_name}</h1>
          <div className="profile-chips">
            {p.hidden_by_admin ? (
              <Chip tone="warn">Hidden by staff</Chip>
            ) : p.show_on_leaderboard ? (
              <Chip tone="ok">On leaderboards</Chip>
            ) : (
              <Chip>Private</Chip>
            )}
            {me.crew && <Chip>{me.crew.name}</Chip>}
          </div>
        </div>
      </section>
      <Button variant="secondary" onClick={() => setEditing(true)}>
        Edit nickname & color
      </Button>

      <section className="mini-stats" aria-label="Your totals">
        <div className="mini-stat">
          <div className="num">{formatNumber(s.total_verified)}</div>
          <span>Verified min</span>
        </div>
        <div className="mini-stat">
          <div className="num">{formatNumber(s.total_pending)}</div>
          <span>Pending min</span>
        </div>
        <div className="mini-stat">
          <div className="num">{s.sessions}</div>
          <span>Sessions</span>
        </div>
        <div className="mini-stat">
          <div className="num">{s.longest_session}</div>
          <span>Longest (min)</span>
        </div>
        <div className="mini-stat">
          <div className="num">{s.current_streak}</div>
          <span>Week streak</span>
        </div>
        <div className="mini-stat">
          <div className="num">{s.longest_streak}</div>
          <span>Best streak</span>
        </div>
      </section>

      <Achievements version={version} />
      <Spindex />
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
            description="Your nickname and stats in the app and on the in-store screen. Your own history stays visible to you either way."
          />
          <Toggle
            checked={p.show_spindex}
            disabled={saving !== ""}
            onChange={(v) => void setPrivacy({ show_spindex: v })}
            label="Show my SPINDEX rating"
            description="On the SPINDEX leaderboard (only if you've added one)."
          />
        </div>
        <p className="small-print">Your email is never shown to other players or on the display.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Account</h2>
        </div>
        <div className="list settings-list">
          {me.admin_role && (
            <Link to="/admin" className="settings-link">
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <ShieldCheck size={18} style={{ color: "var(--pink)" }} /> Staff dashboard
              </span>
              <ChevronRight size={18} />
            </Link>
          )}
          <button className="settings-link" onClick={() => setPw(true)}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <KeyRound size={18} /> Change password
            </span>
            <ChevronRight size={18} />
          </button>
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
        <span>Morrisville Rewards · Beta</span>
        <span>
          A four-week pilot run by PingPod Morrisville. It's separate from the official PingPod app and booking system.
          Session times are self-reported or timed in this app; staff verify them.
        </span>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = nicknameProblem(name);
  return (
    <Sheet title="Edit profile" onClose={onClose}>
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
          <span className="label">Avatar color</span>
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
        <Skeleton count={2} height={80} />
      ) : (
        <div className="badges">
          {[...items].sort(BADGE_ORDER).map((a) => (
            <div key={a.code} className={`badge ${a.earned_at ? "earned" : ""}`}>
              <span className="badge-icon">
                <Award size={20} />
              </span>
              <span className="badge-text">
                <strong>{a.title}</strong>
                <span>{a.earned_at ? `Earned ${formatDay(a.earned_at.slice(0, 10))}` : a.description}</span>
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
      <p className="small-print">Milestones come from your sessions automatically. Rejected sessions don't count.</p>
    </section>
  );
}

function Spindex() {
  const { me, refresh, bump } = useApp();
  const toast = useToast();
  const claim = me.spindex ?? null;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(claim ? String(claim.rating) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const value = Number(rating);
  const valid = rating !== "" && Number.isInteger(value) && value >= 0 && value <= 3000;
  return (
    <section className="section">
      <div className="section-head">
        <h2>SPINDEX</h2>
      </div>
      <div className="panel stack-sm">
        {claim ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span className="spindex-value num">{claim.rating}</span>
              {claim.status === "verified" ? (
                <Chip tone="ok">Verified by staff{claim.verified_at ? ` · ${formatDay(claim.verified_at.slice(0, 10))}` : ""}</Chip>
              ) : (
                <Chip tone="warn">Self-reported SPINDEX</Chip>
              )}
            </div>
            <p className="small-print">
              {claim.status === "verified"
                ? "PingPod staff checked this rating. Updating it will make it self-reported again until staff re-check."
                : "You entered this number. Show your SPINDEX at the front desk if you'd like staff to verify it."}
            </p>
            <div className="row-2">
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Update
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Have a SPINDEX rating? Add it to your profile. It shows up on the separate SPINDEX board — it never affects
              minutes or streaks.
            </p>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Add my SPINDEX
            </Button>
          </>
        )}
        <p className="small-print">
          This app isn't connected to SPINDEX or PodPlay and never asks for those passwords. Ratings you enter are labeled
          self-reported.
        </p>
      </div>
      {open && (
        <Sheet title="Your SPINDEX" onClose={() => setOpen(false)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!valid) return setError("SPINDEX ratings run from 0 to 3000.");
              setBusy(true);
              setError("");
              try {
                await api.submitSpindex(value, note.trim() || undefined);
                await refresh();
                bump();
                toast("SPINDEX saved as self-reported.");
                setOpen(false);
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label="Rating (0–3000)"
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={0}
              max={3000}
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            />
            <Field
              label="Where's it from? (optional)"
              maxLength={200}
              placeholder="e.g. SPINDEX app, Nov 2026"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {claim?.status === "verified" && (
              <p className="small-print">Saving a new number replaces your verified rating with a self-reported one.</p>
            )}
            {error && <InlineError>{error}</InlineError>}
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!rating}>
              Save as self-reported
            </Button>
          </form>
        </Sheet>
      )}
      {removing && (
        <ConfirmSheet
          title="Remove SPINDEX?"
          body={<p>Your rating will disappear from your profile and the SPINDEX board.</p>}
          confirmLabel="Remove rating"
          danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await api.removeSpindex();
            await refresh();
            bump();
            toast("SPINDEX removed.");
          }}
        />
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
      .mySessions(limit + 1)
      .then(setRows)
      .catch((err) => setError(errorText(err)));
  }, [limit]);
  useEffect(load, [load, version]);
  return (
    <section className="section" id="history">
      <div className="section-head">
        <h2>History</h2>
      </div>
      {error ? (
        <InlineError onRetry={load}>{error}</InlineError>
      ) : !rows ? (
        <Skeleton count={3} height={64} />
      ) : rows.length === 0 ? (
        <div className="panel small-print">Your sessions will show up here.</div>
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
  const { bump } = useApp();
  const [asking, setAsking] = useState(false);
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
            : `Self-reported · logged ${formatDateTime(s.created_at)}`}
          {s.submitted_minutes != null && s.submitted_minutes !== s.minutes && ` · you submitted ${formatDuration(s.submitted_minutes)}`}
        </p>
        {s.auto_closed && <p className="small-print">This timer ran to the limit and was stopped automatically.</p>}
        {s.note && <p>“{s.note}”</p>}
        {s.review_reason && (s.status === "rejected" || s.status === "approved") && (
          <p className="staff-reply">Staff note: {s.review_reason}</p>
        )}
        {s.status === "pending" && (
          <p className="small-print">Waiting for staff to verify. It already counts on Community boards.</p>
        )}
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
          <Button variant="secondary" block onClick={() => setAsking(true)}>
            Request a correction
          </Button>
        )
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
    <Sheet title="Change password" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 6) return setError("Use at least 6 characters.");
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
        <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="At least 6 characters" />
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
