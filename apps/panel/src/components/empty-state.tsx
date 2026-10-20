import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";
import type { IconName } from "./icon.tsx";

export interface EmptyStateProps {
  readonly icon: IconName;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

/**
 * empty-state: a presentational placeholder for a view with nothing to show.
 * A decorative icon, a title, an optional explanation and an optional action.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon name={icon} size={20} />
      </span>
      <h2 className="empty-state__title">{title}</h2>
      {description ? <p className="empty-state__description">{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
