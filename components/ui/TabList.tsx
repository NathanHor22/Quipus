"use client";

import { useRef, type ReactNode } from "react";

export type TabOption<Value extends string> = {
  value: Value;
  label: ReactNode;
  id?: string;
  panelId?: string;
  disabled?: boolean;
};

type TabListProps<Value extends string> = {
  tabs: readonly TabOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  "aria-label": string;
  className?: string;
  tabClassName?: string;
};

/** Controlled tabs share roving focus; callers retain their panels and styles. */
export function TabList<Value extends string>({
  tabs, value, onValueChange, className, tabClassName, "aria-label": label,
}: TabListProps<Value>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = tabs.findIndex(tab => tab.value === value && !tab.disabled);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : tabs.findIndex(tab => !tab.disabled);
  return <div className={className} role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button
      key={tab.value}
      ref={(button) => { buttons.current[index] = button; }}
      type="button"
      role="tab"
      id={tab.id}
      aria-controls={tab.panelId}
      aria-selected={value === tab.value}
      tabIndex={index === focusIndex ? 0 : -1}
      disabled={tab.disabled}
      className={tabClassName}
      onClick={() => onValueChange(tab.value)}
      onKeyDown={(event) => {
        const enabled = tabs.map((item, position) => item.disabled ? -1 : position)
          .filter(position => position >= 0);
        if (!enabled.length) return;
        const current = enabled.indexOf(index);
        const next = event.key === "ArrowRight" ? enabled[(current + 1) % enabled.length]
          : event.key === "ArrowLeft" ? enabled[(current + enabled.length - 1) % enabled.length]
          : event.key === "Home" ? enabled[0]
          : event.key === "End" ? enabled[enabled.length - 1]
          : undefined;
        if (next === undefined) return;
        event.preventDefault();
        onValueChange(tabs[next].value);
        buttons.current[next]?.focus();
      }}
    >{tab.label}</button>)}
  </div>;
}
