// Where the join QR points. Order: the URL saved in pilot settings (admin-editable),
// then VITE_PUBLIC_APP_URL, then the current origin. Never silently print a dev URL.

const LOCAL_PATTERN = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\.local(?::|\/|$)/i;

export function resolveAppUrl(fromSettings?: string | null): string {
  const env = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  const raw = (fromSettings || env || window.location.origin).trim();
  return raw.replace(/\/+$/, "");
}

/** The address people can read and type: no protocol, no trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function isLocalUrl(url: string): boolean {
  return LOCAL_PATTERN.test(url);
}
