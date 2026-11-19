import { lazy, Suspense, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Home as HomeIcon, Trophy, UserRound, Users } from "lucide-react";
import { api, errorText, type AuthUser } from "./lib/api";
import { currentPath, Link, navigate, usePath } from "./lib/router";
import { KEYS, store, type PendingStop } from "./lib/storage";
import type { Me, PlaySession } from "./lib/types";
import { AppCtx, type AppState } from "./state";
import { Logo, PingPodMark } from "./components/Logo";
import Splash, { shouldShowSplash } from "./components/Splash";
import { Avatar, Button, InlineError, useOnline } from "./components/ui";
import Welcome from "./screens/Welcome";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";
import Rankings from "./screens/Rankings";
import Crew from "./screens/Crew";
import MeScreen from "./screens/Me";
import JoinCrew from "./screens/JoinCrew";
import ResetPassword from "./screens/ResetPassword";

const Display = lazy(() => import("./display/Display"));
const Poster = lazy(() => import("./display/Poster"));
const AdminApp = lazy(() => import("./admin/AdminApp"));

export function Boot({ label = "Loading" }: { label?: string }) {
  return (
    <div className="boot" role="status">
      <PingPodMark height={30} />
      <span>{label}…</span>
    </div>
  );
}

export default function App() {
  const path = usePath();
  const [splash, setSplash] = useState(() => !["/display", "/poster"].includes(currentPath()) && shouldShowSplash());
  if (path === "/display")
    return (
      <Suspense fallback={<Boot label="Loading the leaderboard" />}>
        <Display />
      </Suspense>
    );
  if (path === "/poster")
    return (
      <Suspense fallback={<Boot />}>
        <Poster />
      </Suspense>
    );
  return (
    <>
      <PlayerApp path={path} />
      {splash && <Splash onDone={() => setSplash(false)} />}
    </>
  );
}

type AuthState = { status: "loading" } | { status: "out" } | { status: "in"; user: AuthUser; recovery: boolean };

function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    void api
      .getUser()
      .then((user) => {
        if (alive) setState(user ? { status: "in", user, recovery: false } : { status: "out" });
      })
      .catch(() => alive && setState({ status: "out" }));
    const off = api.onAuthChange((event, user) => {
      if (!alive) return;
      if (!user) setState({ status: "out" });
      else
        setState((prev) => ({
          status: "in",
          user,
          recovery: event === "PASSWORD_RECOVERY" || (prev.status === "in" && prev.recovery && event !== "SIGNED_OUT"),
        }));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

function PlayerApp({ path }: { path: string }) {
  const auth = useAuth();
  const inviteMatch = path.match(/^\/join\/([A-Za-z0-9-]{4,16})$/);
  const inviteCode = inviteMatch ? inviteMatch[1].toUpperCase() : null;

  useEffect(() => {
    if (inviteCode) store.set(KEYS.invite, inviteCode);
  }, [inviteCode]);

  if (auth.status === "loading") return <Boot />;
  if (auth.status === "out") return <Welcome inviteCode={inviteCode ?? store.get<string>(KEYS.invite)} />;
  if (auth.recovery || path === "/reset-password") return <ResetPassword />;
  return <SignedIn user={auth.user} path={path} inviteCode={inviteCode} />;
}

type Tab = "/" | "/rankings" | "/crew" | "/me";
const TAB_ORDER: Tab[] = ["/", "/rankings", "/crew", "/me"];
function tabFor(path: string, inviteCode: string | null): Tab {
  if (inviteCode) return "/crew";
  return (TAB_ORDER as string[]).includes(path) ? (path as Tab) : "/";
}

function SignedIn({ user, path, inviteCode }: { user: AuthUser; path: string; inviteCode: string | null }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");
  const [finished, setFinished] = useState<PlaySession | null>(null);
  const [version, setVersion] = useState(0);
  const offset = useRef(0);
  const online = useOnline();

  // Tabs slide in from the side you're moving toward (Home → Rankings → Crew → Me).
  const currentTab = tabFor(path, inviteCode);
  const prevTab = useRef<Tab>(currentTab);
  const dirRef = useRef<"fwd" | "back" | "none">("none");
  if (prevTab.current !== currentTab) {
    const d = TAB_ORDER.indexOf(currentTab) - TAB_ORDER.indexOf(prevTab.current);
    dirRef.current = d > 0 ? "fwd" : d < 0 ? "back" : "none";
    prevTab.current = currentTab;
  }
  const direction = dirRef.current;

  const refresh = useCallback(async () => {
    // A finish tapped while offline is replayed first, with the time the player tapped it.
    const pending = store.get<PendingStop>(KEYS.pendingStop);
    if (pending) {
      try {
        const done = await api.stopSession(pending.id, pending.endedAt);
        store.remove(KEYS.pendingStop);
        setFinished(done);
        setVersion((v) => v + 1);
      } catch (err) {
        if (!(err as { offline?: boolean }).offline) store.remove(KEYS.pendingStop);
      }
    }
    const t0 = Date.now();
    const next = await api.getMe();
    const t1 = Date.now();
    offset.current = new Date(next.server_now).getTime() - (t0 + t1) / 2;
    setMe(next);
    setLoadError("");
  }, []);

  useEffect(() => {
    store.set(KEYS.hasAccount, true);
    void refresh().catch((err) => setLoadError(errorText(err)));
  }, [refresh]);

  // Re-sync whenever the player comes back to the tab/app, on reconnect, and every minute.
  useEffect(() => {
    const sync = () => {
      if (!document.hidden) void refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    const id = window.setInterval(sync, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, [refresh]);

  const hasProfile = Boolean(me?.profile);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [path, hasProfile]);

  const state = useMemo<AppState | null>(
    () =>
      me && {
        user,
        me,
        serverNow: () => Date.now() + offset.current,
        refresh,
        signOut: async () => {
          await api.signOut();
          navigate("/", { replace: true });
        },
        finished,
        setFinished,
        version,
        bump: () => setVersion((v) => v + 1),
      },
    [me, user, refresh, finished, version],
  );

  if (!state)
    return loadError ? (
      <div className="boot">
        <PingPodMark height={30} />
        <div style={{ maxWidth: 320, display: "grid", gap: 12 }}>
          <InlineError onRetry={() => void refresh().catch((err) => setLoadError(errorText(err)))}>{loadError}</InlineError>
          <Button variant="ghost" onClick={() => void api.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    ) : (
      <Boot label="Loading your account" />
    );

  if (!state.me.profile)
    return (
      <AppCtx.Provider value={state}>
        <Onboarding />
      </AppCtx.Provider>
    );

  if (path === "/admin")
    return (
      <AppCtx.Provider value={state}>
        <Suspense fallback={<Boot label="Loading staff tools" />}>
          <AdminApp me={state.me} refreshMe={refresh} onSignOut={() => void state.signOut()} />
        </Suspense>
      </AppCtx.Provider>
    );

  let screen: ReactNode;
  let tab: Tab = "/";
  if (inviteCode) {
    screen = <JoinCrew code={inviteCode} />;
    tab = "/crew";
  } else if (path === "/rankings") {
    screen = <Rankings />;
    tab = "/rankings";
  } else if (path === "/crew") {
    screen = <Crew />;
    tab = "/crew";
  } else if (path === "/me") {
    screen = <MeScreen />;
    tab = "/me";
  } else {
    screen = <Home />;
  }

  return (
    <AppCtx.Provider value={state}>
      <div className="app">
        <header className="app-header">
          <div className="app-header-inner">
            <Link to="/" className="pp-logo-link" aria-label="Home" style={{ textDecoration: "none" }}>
              <Logo size="sm" sub="Morrisville Rewards · Beta" />
            </Link>
            <Link to="/me" className="header-avatar" aria-label="Your profile">
              <Avatar name={state.me.profile.display_name} color={state.me.profile.avatar_color} size={36} />
            </Link>
          </div>
        </header>
        <main key={inviteCode ? `join-${inviteCode}` : tab} className={`screen screen-${direction}`}>
          {screen}
        </main>
        {!online && <div className="offline-bar">You're offline. A running timer keeps counting — we'll sync when you're back.</div>}
        <nav className="bottom-nav" aria-label="Main">
          <span className="nav-indicator" style={{ "--i": TAB_ORDER.indexOf(currentTab) } as CSSProperties} aria-hidden />
          <NavItem to="/" label="Home" active={tab === "/"} icon={<HomeIcon size={22} />} />
          <NavItem to="/rankings" label="Rankings" active={tab === "/rankings"} icon={<Trophy size={22} />} />
          <NavItem to="/crew" label="Crew" active={tab === "/crew"} icon={<Users size={22} />} />
          <NavItem to="/me" label="Me" active={tab === "/me"} icon={<UserRound size={22} />} />
        </nav>
      </div>
    </AppCtx.Provider>
  );
}

function NavItem({ to, label, icon, active }: { to: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Link to={to} aria-current={active ? "page" : undefined}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}
