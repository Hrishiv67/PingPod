import { Crown, Flame, Rocket, Shield, Star, Target, Users, Zap, type LucideIcon } from "lucide-react";
import type { AvatarColor, CrewEmblem } from "../lib/types";

export const EMBLEMS: { value: CrewEmblem; label: string; Icon: LucideIcon }[] = [
  { value: "users", label: "Crew", Icon: Users },
  { value: "flame", label: "Flame", Icon: Flame },
  { value: "bolt", label: "Bolt", Icon: Zap },
  { value: "crown", label: "Crown", Icon: Crown },
  { value: "target", label: "Target", Icon: Target },
  { value: "rocket", label: "Rocket", Icon: Rocket },
  { value: "star", label: "Star", Icon: Star },
  { value: "shield", label: "Shield", Icon: Shield },
];

export function emblemIcon(emblem?: CrewEmblem | null): LucideIcon {
  return EMBLEMS.find((e) => e.value === emblem)?.Icon ?? Users;
}

/** A crew's emblem on its color. Sizes: 36 in lists, 56 on the crew page. */
export default function CrewBadge({ emblem, color, size = 36 }: { emblem?: CrewEmblem | null; color?: AvatarColor | null; size?: number }) {
  const Icon = emblemIcon(emblem);
  return (
    <span
      className={`crew-badge avatar-${color ?? "pink"}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2.4} />
    </span>
  );
}
