/** The public address for links people share. The old vercel.app address points people to the new domain. */
export const SITE = "https://www.pingpodrewards.site";

export function siteOrigin(): string {
  return /(^|\.)vercel\.app$/.test(window.location.hostname) ? SITE : window.location.origin;
}

export function inviteLink(code: string): string {
  return `${siteOrigin()}/join/${code}`;
}
