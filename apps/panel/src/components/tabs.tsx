import { useRef } from "react";
import type { KeyboardEvent } from "react";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly panelId: string;
}

export interface TabsProps {
  readonly label: string;
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}

/**
 * tabs: a controlled ARIA tab list with roving focus. The selected tab is the
 * only one in the tab order (`tabIndex` 0); the others are `-1`. ArrowLeft,
 * ArrowRight, Home and End move the selection through `onChange`.
 */
export function Tabs({ label, tabs, value, onChange }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.id === value);
    if (current < 0) return;
    const lastIndex = tabs.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = current === lastIndex ? 0 : current + 1;
        break;
      case "ArrowLeft":
        next = current === 0 ? lastIndex : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = lastIndex;
        break;
      default:
        return;
    }
    event.preventDefault();
    const id = tabs[next]?.id;
    if (id !== undefined && id !== value) {
      onChange(id);
      refs.current.get(id)?.focus();
    }
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={tab.panelId}
            tabIndex={selected ? 0 : -1}
            className="tabs__tab"
            onClick={() => { onChange(tab.id); }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
