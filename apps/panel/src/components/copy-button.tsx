import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon.tsx";

export interface CopyButtonProps {
  readonly value: string;
  readonly label?: string;
  readonly copiedLabel?: string;
}

/**
 * copy-button: writes `value` to the clipboard and shows `copiedLabel` for
 * 2000ms. A rejected write returns the control to its resting label; there is
 * no live region here — action results are announced through `Status`.
 */
export function CopyButton({ value, label = "Copy", copiedLabel = "Copied" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      timer.current = window.setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="copy-button" onClick={() => { void handleClick(); }}>
      <Icon name={copied ? "check" : "copy"} />
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
