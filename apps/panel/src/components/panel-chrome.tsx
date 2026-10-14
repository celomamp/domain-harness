import { NavLink } from "react-router";
import type { Role } from "@domain-harness/contract";

/** Destinations that exist so far; later stories add their own. */
export const PANEL_NAV = [
  { to: "/inventory", label: "Inventory" },
  { to: "/standards", label: "Standards" },
  { to: "/projects", label: "Project tree" },
  { to: "/new-application", label: "New-application flow" },
  { to: "/accepted-deviation", label: "Accepted deviation" },
] as const;

/**
 * panel-chrome: the wordmark, the signed-in role as text, and the nav. The
 * current destination is marked `aria-current="page"` and set at weight 600,
 * never gold.
 */
export function PanelChrome({ role }: { readonly role: Role }) {
  return (
    <header className="panel-chrome">
      <div className="panel-chrome__row">
        <p className="panel-chrome__wordmark">Domain Harness</p>
        <p className="panel-chrome__role type-label">{role}</p>
      </div>
      <nav className="panel-chrome__nav type-label" aria-label="Management panel">
        <ul>
          {PANEL_NAV.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to}>{item.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
