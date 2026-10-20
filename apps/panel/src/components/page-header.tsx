import type { ReactNode } from "react";

export interface PageHeaderProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__content">
        {eyebrow ? <p className="page-header__eyebrow type-caption">{eyebrow}</p> : null}
        <h1 className="page-header__title type-page-title">{title}</h1>
        {description ? <p className="page-header__description type-body-sm">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
      {meta ? <div className="page-header__meta">{meta}</div> : null}
    </header>
  );
}
