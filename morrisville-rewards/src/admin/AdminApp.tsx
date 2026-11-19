import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChartColumn,
  ClipboardCheck,
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
import Review from "./Review";
import Players from "./Players";
import Crews from "./Crews";
import Spindex from "./Spindex";
import Requests from "./Requests";
import Rewards from "./Rewards";
import SettingsTab from "./SettingsTab";
import Analytics from "./Analytics";
import Audit from "./Audit";
import Staff from "./Staff";
import "./admin.css";

type Tab = "review" | "players" | "crews" | "spindex" | "requests" | "rewards" | "settings" | "analytics" | "audit" | "staff";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "review", label: "Review", icon: <ClipboardCheck size={18} /> },
  { id: "players", label: "Players", icon: <Users size={18} /> },
  { id: "crews", label: "Crews", icon: <UsersRound size={18} /> },
  { id: "spindex", label: "SPINDEX", icon: <Gauge size={18} /> },
  { id: "requests", label: "Requests", icon: <Inbox size={18} /> },
  { id: "rewards", label: "Rewards", icon: <Gift size={18} /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={18} /> },
  { id: "analytics", label: "Analytics", icon: <ChartColumn size={18} /> },
  { id: "audit", label: "Audit log", icon: <ScrollText size={18} /> },
  { id: "staff", label: "Staff", icon: <ShieldCheck size={18} /> },
];

function readTab(): Tab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((x) => x.id === t) ? (t as Tab) : "review";
}

type Counts = { review: number; requests: number; spindex: number };

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
  const [counts, setCounts] = useState<Counts | null>(null);
  const [reviewSearch, setReviewSearch] = useState<{ q: string; n: number } | null>(null);
  const isOwner = me.admin_role === "owner";
  const myId = me.profile?.id ?? "";

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "review" ? "/admin" : `/admin?tab=${t}`);
    window.scrollTo({ top: 0 });
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const a = await api.admin.analytics();
      setCounts({ review: a.sessions.pending, requests: a.open_requests, spindex: a.spindex.self_reported });
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

  const badge = (id: Tab) => (counts ? (id === "review" ? counts.review : id === "requests" ? counts.requests : id === "spindex" ? counts.spindex : 0) : 0);
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
          {TABS.map((t) => {
            const n = badge(t.id);
            return (
              <button
                key={t.id}
                className={tab === t.id ? "on" : ""}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
                {n > 0 && (
                  <span className="adm-badge" aria-label={`${n} waiting`}>
                    {n > 99 ? "99+" : n}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <main className="adm-main">
          {tab === "review" && (
            <Review key={reviewSearch?.n ?? 0} settings={me.settings} initialSearch={reviewSearch?.q} onChanged={onChanged} />
          )}
          {tab === "players" && <Players isOwner={isOwner} myId={myId} onChanged={onChanged} />}
          {tab === "crews" && <Crews onChanged={onChanged} />}
          {tab === "spindex" && <Spindex myId={myId} onChanged={onChanged} />}
          {tab === "requests" && (
            <Requests
              isOwner={isOwner}
              onChanged={onChanged}
              onOpenSession={(q) => {
                setReviewSearch((r) => ({ q, n: (r?.n ?? 0) + 1 }));
                setTab("review");
              }}
            />
          )}
          {tab === "rewards" && <Rewards isOwner={isOwner} rewardsVisible={me.settings.rewards_enabled} />}
          {tab === "settings" && <SettingsTab isOwner={isOwner} fallback={me.settings} onSaved={refreshMe} />}
          {tab === "analytics" && <Analytics />}
          {tab === "audit" && <Audit />}
          {tab === "staff" && <Staff isOwner={isOwner} myId={myId} />}
          <p className="adm-footnote">
            Morrisville Rewards · Beta staff tools. Never sign in as staff on the front-desk iPad — the board at /display needs no login.
          </p>
        </main>
      </div>
    </div>
  );
}

function StaffAccess({ me, refreshMe, onSignOut }: { me: Me; refreshMe: () => Promise<void>; onSignOut: () => void }) {
  const [code, setCode] = useState("");
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
        <h1>Staff access</h1>
        <p>
          This area is for PingPod Morrisville staff. You're signed in as <b>{me.profile?.display_name ?? "a player"}</b>, which is a
          regular player account.
        </p>
        <p className="adm-muted">
          If you're the pilot owner and were given a one-time staff code, enter it below. Other staff are added by an owner from
          the Players list.
        </p>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!code.trim()) return;
            setBusy(true);
            setError("");
            try {
              await api.admin.claim(code.trim());
              await refreshMe();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
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
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!code.trim()}>
            Unlock staff tools
          </Button>
          <Button type="button" variant="ghost" size="lg" block onClick={() => navigate("/")}>
            Back to the app
          </Button>
        </form>
      </main>
    </div>
  );
}
