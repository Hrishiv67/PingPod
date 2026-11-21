// Catches mistyped or made-up email domains at sign-in, without sending anything.
// What this can and can't do: it proves the DOMAIN can receive email (and catches typos like
// "gmial.com"), but not that the person owns the inbox. Only sending a code proves that.

const COMMON = [
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "live.com",
  "msn.com", "me.com", "comcast.net", "protonmail.com", "proton.me", "att.net", "verizon.net",
];

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** "name@gmial.com" → "name@gmail.com"; null when the domain looks fine. */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (COMMON.includes(domain)) return null;
  let best: string | null = null;
  let bestD = 3;
  for (const c of COMMON) {
    const dist = distance(domain, c);
    if (dist < bestD) {
      bestD = dist;
      best = c;
    }
  }
  return best && bestD <= 2 ? `${local}@${best}` : null;
}

async function lookup(name: string, type: "MX" | "A"): Promise<{ status: number; answers: number }> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: ctrl.signal,
    });
    const j = (await r.json()) as { Status: number; Answer?: unknown[] };
    return { status: j.Status, answers: j.Answer?.length ?? 0 };
  } finally {
    window.clearTimeout(t);
  }
}

/** true = can receive mail, false = can't, null = couldn't check (let them through). */
export async function domainAcceptsMail(email: string): Promise<boolean | null> {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (!domain || COMMON.includes(domain)) return true;
  try {
    const mx = await lookup(domain, "MX");
    if (mx.status === 3) return false; // domain doesn't exist
    if (mx.answers > 0) return true;
    const a = await lookup(domain, "A");
    return a.answers > 0;
  } catch {
    return null;
  }
}
