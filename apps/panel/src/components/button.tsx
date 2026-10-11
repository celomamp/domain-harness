import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary`: the one gold action that moves the work forward. `inverse`: a secondary commit, never publish. */
  readonly variant: "primary" | "inverse";
}

/** button-primary / button-inverse from DESIGN.md. */
export function Button({ variant, className, type = "button", ...props }: ButtonProps) {
  const classes = [`button-${variant}`, className].filter(Boolean).join(" ");
  return <button {...props} type={type} className={classes} />;
}
