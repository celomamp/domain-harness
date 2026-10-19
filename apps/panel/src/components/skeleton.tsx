export interface SkeletonProps {
  readonly lines?: number;
  readonly className?: string;
}

/**
 * skeleton: a presentational loading placeholder. It is `aria-hidden`; the
 * owning region announces its busy state through `aria-busy`, so the lines
 * never reach assistive technology.
 */
export function Skeleton({ lines = 3, className }: SkeletonProps) {
  const classes = ["skeleton", className].filter(Boolean).join(" ");
  return (
    <div className={classes} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton__line" />
      ))}
    </div>
  );
}
