import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// Tiny History-API router (no dependency). Vercel rewrites every path to index.html.
const EVENT = "pingpod:navigate";

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

/** Current route path. `/?display=1` (the original starter link) maps to `/display`. */
export function currentPath(): string {
  const params = new URLSearchParams(window.location.search);
  if (params.has("display")) return "/display";
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export function usePath(): string {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return currentPath();
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  if (opts.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
  if (!opts.replace) window.scrollTo({ top: 0 });
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
