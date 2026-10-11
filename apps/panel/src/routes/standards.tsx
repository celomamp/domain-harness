import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Standards | Domain Harness" }];

/** Standards shell: Modules and publishing arrive in later stories. */
export default function Standards() {
  return (
    <>
      <h1 className="type-title">Standards</h1>
      <p>No Standard is published yet.</p>
    </>
  );
}
