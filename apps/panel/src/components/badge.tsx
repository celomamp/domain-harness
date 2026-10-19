import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export interface BadgeProps {
  readonly tone: "neutral" | "outline" | "solid";
  readonly icon?: IconName;
  readonly children: ReactNode;
}

export function Badge({ tone, icon, children }: BadgeProps) {
  return (
    <span className="badge" data-tone={tone}>
      {icon ? <Icon name={icon} /> : null}
      <span className="badge__label">{children}</span>
    </span>
  );
}
