// PingPod mark (ball + table + net), redrawn as SVG from the official logo asset
// (pingpod.com header logo / the PingPod.webp file in this repo) so it stays sharp at any size.
export function PingPodMark({ height = 22, title }: { height?: number; title?: string }) {
  return (
    <svg
      className="pp-mark"
      viewBox="18 88 204 64"
      height={height}
      width={(height * 204) / 64}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <circle cx="27.5" cy="97.5" r="7.5" fill="var(--pink)" />
      <path d="M55 90h124v32H55z M63 98v16h108V98z" fill="currentColor" fillRule="evenodd" />
      <path d="M179 90h41l-41 32z" fill="var(--pink)" />
      <path d="M55 122h62l-35 28H20z" fill="currentColor" />
      <path d="M117 122h62l-35 28H82z" fill="var(--pink)" />
    </svg>
  );
}

/** Mark + PINGPOD wordmark + optional location line. */
export function Logo({ size = "md", sub }: { size?: "sm" | "md" | "lg"; sub?: string }) {
  const h = size === "lg" ? 34 : size === "sm" ? 18 : 22;
  return (
    <span className={`pp-logo pp-logo-${size}`}>
      <PingPodMark height={h} />
      <span className="pp-logo-text">
        <span className="pp-wordmark">PINGPOD</span>
        {sub && <span className="pp-logo-sub">{sub}</span>}
      </span>
    </span>
  );
}
