import { PingPodMark } from "./Logo";

/** Subtle loading state: a dim PingPod mark with a soft light sweeping across it. */
export default function LogoLoader({ size = 26, label = "Loading", full = false }: { size?: number; label?: string; full?: boolean }) {
  return (
    <div className={`logo-loader ${full ? "logo-loader-full" : ""}`} role="status" aria-label={label}>
      <span className="logo-loader-mark">
        <PingPodMark height={size} />
        <span className="logo-loader-shine" aria-hidden>
          <PingPodMark height={size} />
        </span>
      </span>
    </div>
  );
}
