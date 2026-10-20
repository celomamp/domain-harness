import type { ReactNode } from "react";

export type BannerTone = "notice" | "denial" | "success";

export interface BannerProps {
  readonly tone: BannerTone;
  readonly title?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly live?: boolean;
}

/**
 * banner: a surface that carries a message. It is presentational by default;
 * only a loader that must be announced opts in with `live`, which adds
 * `role="status"` and `aria-live="polite"`. `Status` remains the single live
 * region for action results.
 */
export function Banner({ tone, title, children, action, live = false }: BannerProps) {
  const liveProps = live ? ({ role: "status", "aria-live": "polite" } as const) : {};
  return (
    <div className={`banner banner--${tone}`} {...liveProps}>
      {title ? <p className="banner__title">{title}</p> : null}
      <div className="banner__content">{children}</div>
      {action ? <div className="banner__action">{action}</div> : null}
    </div>
  );
}
