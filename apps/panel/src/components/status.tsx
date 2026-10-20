import { useEffect, useRef } from "react";

export interface StatusProps {
  /** The text to announce; nothing is announced while it is undefined. */
  readonly message: string | undefined;
  /** `denial`: a refused action (denial component). `notice`: plain ink text. */
  readonly tone: "denial" | "notice";
}

/**
 * A live status region. The region is always rendered so that assistive
 * technology announces the message when it appears; a denial uses the denial
 * component (raised surface, ink text, hairline border; the word is the state).
 * A new message outside the viewport (a form submitted far down the page) is
 * scrolled into view, so the outcome of every commit is seen as well as heard.
 */
export function Status({ message, tone }: StatusProps) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = region.current;
    if (message === undefined || element === null || typeof element.scrollIntoView !== "function") return;
    const { top, bottom } = element.getBoundingClientRect();
    if (top >= 0 && bottom <= window.innerHeight) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, [message]);
  return (
    <div ref={region} className="page-status" role="status" aria-live="polite" aria-atomic="true">
      {message === undefined ? null : <p className={tone === "denial" ? "denial" : "status-text"}>{message}</p>}
    </div>
  );
}
