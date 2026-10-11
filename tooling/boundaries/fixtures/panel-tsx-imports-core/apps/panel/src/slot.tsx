import type { Slot } from "../../../packages/core/src/index.ts";

export function SlotName({ slot }: { readonly slot: Slot }) {
  return <span>{slot}</span>;
}
