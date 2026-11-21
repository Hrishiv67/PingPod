// Email-only sign-in. Players never see or choose a password: the app derives one from the email
// address and uses Supabase's normal email + password sign-in under the hood. That means anyone
// who knows a player's email can open that player's account, which is an accepted trade-off for
// this pilot (it's a play-time leaderboard). Staff accounts are different: they keep a real
// password, so the derived key never opens staff tools.
//
// Key: "Pp!" + first 40 hex chars of SHA-256(lowercased trimmed email + SALT) + "9" (also checked in
// the database by private.on_email_key — keep both in sync).

const SALT = "|pingpod-morrisville-email-only-v1";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function emailKey(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeEmail(email) + SALT);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `Pp!${hex.slice(0, 40)}9`;
}
