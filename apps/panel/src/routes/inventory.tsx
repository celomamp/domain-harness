import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Inventory | Domain Harness" }];

/** Inventory shell: no Application exists yet, so it shows the empty state. */
export default function Inventory() {
  return (
    <>
      <h1 className="type-title">Inventory</h1>
      <p className="type-display">No Application yet.</p>
    </>
  );
}
