import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChartColumn,
  ChevronRight,
  ClipboardList,
  Ellipsis,
  Gauge,
  Gift,
  Inbox,
  KeyRound,
  LogOut,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { api, errorText } from "../lib/api";
import type { Me } from "../lib/types";
import { Logo } from "../components/Logo";
import { Button, Chip, Field, InlineError } from "../components/ui";
import { Link, navigate } from "../lib/router";
import Sessions from "./Sessions";
import Players from "./Players";
import Crews from "./Crews";
import Spindex from "./Spindex";
import Requests from "./Requests";
import Rewards from "./Rewards";
import SettingsTab from "./SettingsTab";
import Stats from "./Stats";
import Audit from "./Audit";
import Staff from "./Staff";
import "./admin.css";

type Primary = "sessions" | "players" | "crews" | "stats" | "settings" | "more";
type Extra = "requests" | "spindex" | "rewards" | "staff" | "activity";
type Tab = Primary | Extra;

const PRIMARY: { id: Primary; label: string; icon: ReactNode }[] = [
  { id: "sessions", label: "Sessions", icon: <ClipboardList size={18} /> },
  { id: "players", label: "Players", icon: <Users size={18} /> },
  { id: "crews", label: "Crews", icon: <UsersRound size={18} /> },
  { id: "stats", label: "Stats", icon: <ChartColumn size={18} /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={18} /> },
  { id: "more", label: "More", icon: <Ellipsis size={18} /> },
];

const EXTRAS: { id: Extra; label: string; text: string; icon: ReactNode }[] = [
  { id: "requests", label: "Player requests", text: "Corrections and privacy questions from players", icon: <Inbox size={20} /> },
  { id: "spindex", label: "SPINDEX ratings", text: "Check ratings players add to their profile", icon: <Gauge size={20} /> },
  { id: "rewards", label: "Rewards", text: "Prizes stay off until Joe approves the terms", icon: <Gift size={20} /> },
  { id: "staff", label: "Staff", text: "Who can open this dashboard", icon: <ShieldCheck size={20} /> },
  { id: "activity", label: "Activity log", text: "Every change staff have made", icon: <ScrollText size={20} /> },
];

// Old links (?tab=review, ?tab=analytics, ?tab=audit) keep working.
const ALIASES: Record<string, Tab> = { review: "sessions", analytics: "stats", audit: "activity" };
const ALL: Tab[] = [...PRIMARY.map((p) => p.id), ...EXTRAS.map((e) => e.id)];

function readTab(): Tab {
  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const t = ALIASES[raw] ?? raw;
  return ALL.includes(t as Tab) ? (t as Tab) : "sessions";
}

const isExtra = (t: Tab): t is Extra => EXTRAS.some((e) => e.id === t);

type Counts = { requests: number; spindex: number };

export default function AdminApp({
  me,
  onSignOut,
  refreshMe,
}: {
  me: Me;
  onSignOut: () => void;
  refreshMe: () => Promise<void>;
}) {
  if (!me.admin_role) return <StaffAccess me={me} refreshMe={refreshMe} onSignOut={onSignOut} />;
  return <Dashboard me={me} onSignOut={onSignOut} refreshMe={refreshMe} />;
}

function Dashboard({ me, onSignOut, refreshMe }: { me: Me; onSignOut: () => void; refreshMe: () => Promise<void> }) {
  const [tab, setTabState] = useState<Tab>(readTab);
  const [counts, setCounts] = useState<Counts>({ requests: 0, spindex: 0 });
  const [sessionSearch, setSessionSearch] = useState<{ q: string; n: number } | null>(null);
  const isOwner = me.admin_role === "owner";
  const myId = me.profile?.id ?? "";

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "sessions" ? "/admin" : `/admin?tab=${t}`);
    window.scrollTo({ top: 0 });
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const a = await api.admin.analytics();
      setCounts({ requests: a.open_requests, spindex: a.spindex.self_reported });
    } catch {
      /* badges are optional */
    }
  }, []);

  useEffect(() => {
    void loadCounts();
    const id = window.setInterval(() => void loadCounts(), 60_000);
    const onVis = () => {
      if (!document.hidden) void loadCounts();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadCounts]);

  useEffect(() => {
    const onPop = () => setTabState(readTab());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const extraCount = (id: Extra) => (id === "requests" ? counts.requests : id === "spindex" ? counts.spindex : 0);
  const moreCount = counts.requests + counts.spindex;
  const activeNav: Primary = isExtra(tab) ? "more" : tab;
  const onChanged = () => void loadCounts();

  return (
    <div className="adm">
      <header className="adm-header">
        <div className="adm-header-inner">
          <Link to="/" className="adm-brand" aria-label="Back to the app">
            <Logo size="sm" />
            <Chip tone="pink">Staff</Chip>
          </Link>
          <div className="adm-header-right">
            <span className="adm-me">
              {me.profile?.display_name}
              <small>{isOwner ? "Owner" : "Staff"}</small>
            </span>
            <Link to="/" className="btn btn-ghost btn-sm adm-back">
              <ArrowLeft size={16} aria-hidden />
              <span>Back to app</span>
            </Link>
            <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="adm-body">
        <nav className="adm-nav" aria-label="Staff sections">
          {PRIMARY.map((t) => (
            <button
              key={t.id}
              className={activeNav === t.id ? "on" : ""}
              aria-current={activeNav === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.id === "more" && moreCount > 0 && (
                <span className="adm-badge" aria-label={`${moreCount} need attention`}>
                  {moreCount > 99 ? "99+" : moreCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <main className="adm-main">
          {isExtra(tab) && (
            <button className="adm-crumb" onClick={() => setTab("more")}>
              <ArrowLeft size={16} aria-hidden /> More
            </button>
          )}
          {tab === "sessions" && (
            <Sessions key={sessionSearch?.n ?? 0} settings={me.settings} initialSearch={sessionSearch?.q} onChanged={onChanged} />
          )}
          {tab === "players" && <Players isOwner={isOwner} myId={myId} onChanged={onChanged} />}
          {tab === "crews" && <Crews onChanged={onChanged} />}
          {tab === "stats" && <Stats />}
          {tab === "settings" && <SettingsTab isOwner={isOwner} fallback={me.settings} onSaved={refreshMe} />}
          {tab === "more" && (
            <section className="adm-section">
              <div className="adm-section-head">
                <h1>More</h1>
              </div>
              <ul className="adm-rows adm-menu">
                {EXTRAS.map((e) => {
                  const n = extraCount(e.id);
                  return (
                    <li key={e.id}>
                      <button className="adm-menu-item" onClick={() => setTab(e.id)}>
                        <span className="adm-menu-icon">{e.icon}</span>
                        <span className="adm-menu-text">
                          <strong>{e.label}</strong>
                          <span>{e.text}</span>
                        </span>
                        {n > 0 && <span className="adm-badge">{n > 99 ? "99+" : n}</span>}
                        <ChevronRight size={18} className="adm-menu-chevron" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {tab === "requests" && (
            <Requests
              isOwner={isOwner}
              onChanged={onChanged}
              onOpenSession={(q) => {
                setSessionSearch((r) => ({ q, n: (r?.n ?? 0) + 1 }));
                setTab("sessions");
              }}
            />
          )}
          {tab === "spindex" && <Spindex myId={myId} onChanged={onChanged} />}
          {tab === "rewards" && <Rewards isOwner={isOwner} rewardsVisible={me.settings.rewards_enabled} />}
          {tab === "staff" && <Staff isOwner={isOwner} myId={myId} />}
          {tab === "activity" && <Audit />}
        </main>
      </div>
    </div>
  );
}

function StaffAccess({ me, refreshMe, onSignOut }: { me: Me; refreshMe: () => Promise<void>; onSignOut: () => void }) {
  const setup = Boolean(me.staff_needs_password);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="adm adm-gate">
      <header className="adm-header">
        <div className="adm-header-inner">
          <Link to="/" className="adm-brand" aria-label="Back to the app">
            <Logo size="sm" />
          </Link>
          <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="adm-gate-main">
        <div className="adm-gate-icon" aria-hidden>
          <KeyRound size={26} />
        </div>
        <h1>{setup ? "Set your staff password" : "Staff access"}</h1>
        {setup ? (
          <p>
            You're on the staff list, <b>{me.profile?.display_name ?? "there"}</b>. Players sign in with just an email, so staff
            accounts need a password before the staff tools open.
          </p>
        ) : (
          <p>
            You're signed in as <b>{me.profile?.display_name ?? "a player"}</b>. Enter your one-time staff code to open the staff
            tools. Other staff are added by an owner.
          </p>
        )}
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!setup && !code.trim()) return;
            if (password.length < 8) return setError("Choose a staff password of at least 8 characters.");
            setBusy(true);
            setError("");
            try {
              // Players sign in with just their email; staff accounts need a real password first.
              await api.updatePassword(password);
              if (!setup) await api.admin.claim(code.trim());
              await refreshMe();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {!setup && (
            <Field
              label="Staff code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX"
            />
          )}
          <Field
            label="Staff password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="At least 8 characters. From now on you'll sign in with your email and this password."
          />
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={(!setup && !code.trim()) || !password}>
            {setup ? "Save password and open staff tools" : "Unlock staff tools"}
          </Button>
          <Button type="button" variant="ghost" size="lg" block onClick={() => navigate("/")}>
            Back to the app
          </Button>
        </form>
      </main>
    </div>
  );
}
