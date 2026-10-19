import type { ReactNode } from "react";

export interface SectionCardProps {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function SectionCard({ id, title, description, action, children }: SectionCardProps) {
  return (
    <section className="section-card" id={id}>
      <header className="section-card__header">
        <div className="section-card__heading">
          <h2 className="section-card__title type-section-title">{title}</h2>
          {description ? <p className="section-card__description type-body-sm">{description}</p> : null}
        </div>
        {action ? <div className="section-card__action">{action}</div> : null}
      </header>
      <div className="section-card__body">{children}</div>
    </section>
  );
}
