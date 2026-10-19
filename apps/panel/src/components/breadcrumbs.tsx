import { Link } from "react-router";

export interface BreadcrumbItem {
  readonly label: string;
  readonly to?: string;
}

export interface BreadcrumbsProps {
  readonly items: readonly BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs__list">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <li className="breadcrumbs__item" key={`${item.to ?? item.label}-${index.toString()}`}>
              {index > 0 ? (
                <span className="breadcrumbs__separator" aria-hidden="true">
                  ›
                </span>
              ) : null}
              {isCurrent ? (
                <span className="breadcrumbs__current" aria-current="page">
                  {item.label}
                </span>
              ) : item.to ? (
                <Link className="breadcrumbs__link" to={item.to}>
                  {item.label}
                </Link>
              ) : (
                <span className="breadcrumbs__label">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
