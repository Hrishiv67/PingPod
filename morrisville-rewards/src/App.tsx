import { lazy, Suspense, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Home as HomeIcon, Trophy, UserRound, Users } from "lucide-react";
import { api, errorText, type AuthUser } from "./lib/api";
import { currentPath, Link, navigate, usePath } from "./lib/router";
import { KEYS, store, type PendingStop } from "./lib/storage";
import type { Me, PlaySession } from "./lib/types";
import { AppCtx, type AppState } from "./state";
import { Logo, PingPodMark } from "./components/Logo";
import Splash, { shouldShowSplash } from "./components/Splash";
import Tutorial from "./components/Tutorial";
import { markSurveyOpened, openSurvey, SURVEY_ASK, surveyOpened } from "./components/SurveyCard";
import LogoLoader from "./components/LogoLoader";
import { Avatar, Button, InlineError, useOnline } from "./components/ui";
import Welcome from "./screens/Welcome";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";
import Rankings from "./screens/Rankings";
import Crew from "./screens/Crew";
import MeScreen from "./screens/Me";
import JoinCrew from "./screens/JoinCrew";
import { useMilestones } from "./celebrate/useMilestones";
import ResetPassword from "./screens/ResetPassword";

const Display = lazy(() => import("./display/Display"));
const Poster = lazy(() => import("./display/Poster"));
const AdminApp = lazy(() => import("./admin/AdminApp"));
const Celebrations = lazy(() => import("./celebrate/Gallery"));
const SurveySheet = lazy(() => import("./components/SurveySheet"));
const Celebration = lazy(() => import("./celebrate/Celebration").then((m) => ({ default: m.Celebration })));

export function Boot({ label = "Loading" }: { label?: string }) {
  return (
    <LogoLoader full size={34} label={`${label}…`} />
  );
}

export default function App() {
  const path = usePath();
  const [splash, setSplash] = useState(() => !["/display", "/poster", "/celebrations"].includes(currentPath()) && shouldShowSplash());
  if (path === "/display")
    return (
      <Suspense fallback={<Boot label="Loading the leaderboard" />}>
        <Display />
      </Suspense>
    );
  if (path === "/celebrations")
    return (
      <Suspense fallback={<Boot />}>
        <Celebrations />
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
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  useEffect(() => {
    const open = () => setSurveyOpen(true);
    window.addEventListener("pingpod-open-survey", open);
    return () => window.removeEventListener("pingpod-open-survey", open);
  }, []);
  const offset = useRef(0);
  const online = useOnline();
  // Milestone pop-ups (first session, 10 sessions, first hour…) after saves, once per player.
  const milestone = useMilestones(user.id, me, version);

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
    let replayed = false;
    if (pending) {
      try {
        const done = await api.stopSession(pending.id, pending.endedAt);
        store.remove(KEYS.pendingStop);
        setFinished(done);
        replayed = true;
      } catch (err) {
        if (!(err as { offline?: boolean }).offline) store.remove(KEYS.pendingStop);
      }
    }
    const t0 = Date.now();
    let next = await api.getMe();
    // Came back from the emailed verification link? Mark the email verified.
    if (next.profile && !next.profile.email_verified_at && (await api.confirmEmailFromLink())) next = await api.getMe();
    const t1 = Date.now();
    offset.current = new Date(next.server_now).getTime() - (t0 + t1) / 2;
    setMe(next);
    setLoadError("");
    // Lists re-fetch (and milestones are checked) once the new totals are in.
    if (replayed) setVersion((v) => v + 1);
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
  // "How it works" opens by itself once per player (new players right after picking a nickname;
  // existing players on their next visit, since v2 ends with the research survey ask).
  const tutorialKey = `pingpod-tutorial-v2-${user.id}`;
  useEffect(() => {
    if (hasProfile && !store.get<string>(tutorialKey)) setTutorialOpen(true);
  }, [hasProfile, tutorialKey]);
  const closeTutorial = useCallback(() => {
    store.set(tutorialKey, "seen");
    setTutorialOpen(false);
  }, [tutorialKey]);
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
        showTutorial: () => setTutorialOpen(true),
        tutorialOpen,
      },
    [me, user, refresh, finished, version, tutorialOpen],
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
              <Logo size="sm" />
            </Link>
            <Link to="/me" className="header-avatar" aria-label="Your profile">
              <Avatar name={state.me.profile.display_name} color={state.me.profile.avatar_color} path={state.me.profile.avatar_path} size={36} />
            </Link>
          </div>
        </header>
        <main key={inviteCode ? `join-${inviteCode}` : tab} className={`screen screen-${direction}`}>
          {inviteCode ? screen : <FirstVisit tab={tab}>{screen}</FirstVisit>}
        </main>
        {!online && <div className="offline-bar">You're offline. A running timer keeps counting — we'll sync when you're back.</div>}
        {tutorialOpen && (
          <Tutorial
            onClose={closeTutorial}
            survey={
              !state.me.profile.survey_done_at && !surveyOpened(user.id)
                ? {
                    ask: SURVEY_ASK,
                    onOpen: () => {
                      markSurveyOpened(user.id);
                      openSurvey();
                    },
                  }
                : null
            }
          />
        )}
        {surveyOpen && (
          <Suspense fallback={null}>
            <SurveySheet onClose={() => setSurveyOpen(false)} onDone={() => void refresh().catch(() => {})} />
          </Suspense>
        )}
        {!tutorialOpen && !surveyOpen && milestone.current && (
          <Suspense fallback={null}>
            <Celebration key={milestone.current.key} spec={milestone.current} onClose={milestone.next} />
          </Suspense>
        )}
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

// The first time Rankings, Crew or Me opens in a visit, the PingPod loader shows for 0.8 s while the
// screen loads underneath, so it feels like a real app opening a section. Afterwards tabs open instantly.
const seenTabs = new Set<string>(["/"]);
function FirstVisit({ tab, children }: { tab: string; children: ReactNode }) {
  const [ready, setReady] = useState(() => seenTabs.has(tab));
  useEffect(() => {
    if (ready) return;
    seenTabs.add(tab);
    const t = window.setTimeout(() => setReady(true), 800);
    return () => window.clearTimeout(t);
  }, [ready, tab]);
  return (
    <>
      {!ready && (
        <div className="tab-loader">
          <LogoLoader size={34} label="Loading" />
        </div>
      )}
      <div hidden={!ready} className={ready ? "tab-reveal" : undefined}>
        {children}
      </div>
    </>
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
