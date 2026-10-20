import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Form, NavLink } from "react-router";
import type { Role } from "@domain-harness/contract";
import { Icon } from "./icon.tsx";
import type { IconName } from "./icon.tsx";

/** One navigation group: a caption and its destinations in reading order. */
export interface PanelNavGroup {
  readonly label: string;
  readonly items: readonly { readonly to: string; readonly label: string; readonly icon: IconName }[];
}

/**
 * Every destination, grouped for orientation: Monitor, Govern, Operate. The
 * order is reading order and every destination stays present — grouping adds
 * orientation, not access rules.
 */
export const PANEL_NAV: readonly PanelNavGroup[] = [
  {
    label: "Monitor",
    items: [
      { to: "/inventory", label: "Inventory", icon: "inventory" },
      { to: "/compilations", label: "Compilations", icon: "compilations" },
    ],
  },
  {
    label: "Govern",
    items: [
      { to: "/standards", label: "Standards", icon: "standards" },
      { to: "/projects", label: "Project tree", icon: "projects" },
      { to: "/guidance-access", label: "Guidance access", icon: "guidance" },
    ],
  },
  {
    label: "Operate",
    items: [
      { to: "/new-application", label: "New-application flow", icon: "application" },
      { to: "/accepted-deviation", label: "Accepted deviation", icon: "deviation" },
    ],
  },
];

export interface PanelChromeProps {
  readonly role: Role;
  readonly children?: ReactNode;
}

/**
 * The app shell: a skip link, the dark navigation rail (grouped, with the
 * account block), the mobile top bar/drawer below 1024px, and the page content
 * inside `<main id="main">`. The current destination is marked
 * `aria-current="page"` and set at weight 600 on a cream-tinted surface,
 * never gold. The session exposes no account name, so only the role is shown.
 */
export function PanelChrome({ role, children }: PanelChromeProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Close the drawer and return focus to the menu button that opened it.
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButton.current?.focus();
  }, []);

  // On open, move focus into the drawer so the keyboard user is not stranded
  // on the menu button. The close control is the first focusable element.
  useEffect(() => {
    if (!drawerOpen) return;
    closeButton.current?.focus();
  }, [drawerOpen]);

  // While open: Escape closes (returning focus to the menu button) and
  // Tab/Shift+Tab stay within the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = rail.current;
      if (!drawer) return;
      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen, closeDrawer]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <aside
          id="shell-rail"
          ref={rail}
          className={`shell__rail${drawerOpen ? " shell__rail--open" : ""}`}
          aria-label="Panel sidebar"
        >
          <div className="shell__rail-head">
            <p className="shell__wordmark">Domain Harness</p>
            {drawerOpen ? (
              <button type="button" ref={closeButton} className="shell__close" onClick={closeDrawer}>
                <Icon name="close" label="Close menu" />
              </button>
            ) : null}
          </div>
          <nav className="shell__nav" aria-label="Management panel">
            {PANEL_NAV.map((group) => (
              <section key={group.label} className="shell__group">
                <h2 className="shell__group-label type-caption">{group.label}</h2>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        onClick={() => {
                          setDrawerOpen(false);
                        }}
                      >
                        <Icon name={item.icon} />
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          <div className="shell__account">
            <p className="type-label">{role}</p>
            <Form method="post" action="/sign-out">
              <button type="submit" className="shell__signout">
                <Icon name="sign-out" />
                Sign out
              </button>
            </Form>
          </div>
        </aside>
        <div className="shell__content">
          <header className="shell__mobilebar">
            <button
              type="button"
              ref={menuButton}
              className="shell__menu"
              aria-expanded={drawerOpen}
              aria-controls="shell-rail"
              onClick={() => {
                setDrawerOpen((open) => !open);
              }}
            >
              <Icon name="menu" label="Menu" />
            </button>
            <p className="shell__wordmark">Domain Harness</p>
          </header>
          <main id="main" className="panel-main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
