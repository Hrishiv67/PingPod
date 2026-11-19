import { createContext, useContext } from "react";
import type { AuthUser } from "./lib/api";
import type { Me, PlaySession } from "./lib/types";

export interface AppState {
  user: AuthUser;
  me: Me;
  /** Server-corrected "now" in ms (never trust the phone clock for timing). */
  serverNow: () => number;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Result of the most recent finished timer, shown once on Home. */
  finished: PlaySession | null;
  setFinished: (s: PlaySession | null) => void;
  /** Bumped after any write so lists re-fetch. */
  version: number;
  bump: () => void;
}

export const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}
