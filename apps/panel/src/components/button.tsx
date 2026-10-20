import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { useNavigationState } from "./navigation-state.ts";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary`: the one gold action that moves the work forward. `secondary`:
   * a raised surface with a hairline border. `ghost`: transparent with a hover
   * fill. `inverse`: a dark secondary commit, never publish.
   */
  readonly variant: "primary" | "secondary" | "ghost" | "inverse";
}

/**
 * button-primary / button-secondary / button-ghost / button-inverse from DESIGN.md.
 * A submit button that sent its form is busy (a spinner, `aria-busy`, and no
 * second submit) until the router settles, so every commit shows it was heard.
 */
export function Button({ variant, className, type = "button", onClick, disabled, ...props }: ButtonProps) {
  const navigation = useNavigationState();
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (navigation === "idle") setSent(false);
  }, [navigation]);
  const busy = sent && navigation !== "idle";
  const classes = [`button-${variant}`, className].filter(Boolean).join(" ");
  return (
    <button
      {...props}
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={busy ? true : undefined}
      aria-disabled={busy ? true : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (busy) {
          // A second press while the first is in flight sends nothing.
          event.preventDefault();
          return;
        }
        onClick?.(event);
        if (type === "submit" && !event.defaultPrevented) setSent(true);
      }}
    />
  );
}
