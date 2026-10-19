import { Link } from "react-router";
import { Icon, type IconName } from "./icon.tsx";

export interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly icon?: IconName;
  readonly to?: string;
}

export function Stat({ label, value, hint, icon, to }: StatProps) {
  return (
    <div className="stat" role="group" aria-label={label}>
      {icon ? <Icon name={icon} /> : null}
      <span className="stat__label type-body-sm">{label}</span>
      {to ? (
        <Link className="stat__value type-stat" to={to} aria-label={`${label}: ${value}`}>
          {value}
        </Link>
      ) : (
        <span className="stat__value type-stat">{value}</span>
      )}
      {hint ? <span className="stat__hint type-body-sm">{hint}</span> : null}
    </div>
  );
}
