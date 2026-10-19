import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary`: the one gold action that moves the work forward. `secondary`:
   * a raised surface with a hairline border. `ghost`: transparent with a hover
   * fill. `inverse`: a dark secondary commit, never publish.
   */
  readonly variant: "primary" | "secondary" | "ghost" | "inverse";
}

/** button-primary / button-secondary / button-ghost / button-inverse from DESIGN.md. */
export function Button({ variant, className, type = "button", ...props }: ButtonProps) {
  const classes = [`button-${variant}`, className].filter(Boolean).join(" ");
  return <button {...props} type={type} className={classes} />;
}
