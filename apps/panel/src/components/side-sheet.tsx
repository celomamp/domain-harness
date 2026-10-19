import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";

export interface SideSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}

/**
 * side-sheet: a modal side panel. When it opens it focuses its title
 * (`tabIndex={-1}`), traps Tab inside the sheet, closes on Escape, and returns
 * focus to the element that had focus before it opened. jsdom has no native
 * `<dialog>`, so it is a `div role="dialog"` with manual focus control.
 */
export function SideSheet({ open, onClose, title, description, children }: SideSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="side-sheet">
      <div className="side-sheet__backdrop" onClick={onClose} />
      <div
        ref={sheetRef}
        className="side-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="side-sheet__header">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="side-sheet__title">
            {title}
          </h2>
          <button type="button" className="side-sheet__close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        {description ? <p className="side-sheet__description">{description}</p> : null}
        <div className="side-sheet__body">{children}</div>
      </div>
    </div>
  );
}
