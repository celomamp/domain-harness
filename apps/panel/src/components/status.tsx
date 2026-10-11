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
 */
export function Status({ message, tone }: StatusProps) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {message === undefined ? null : <p className={tone === "denial" ? "denial" : "status-text"}>{message}</p>}
    </div>
  );
}
