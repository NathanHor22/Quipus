"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

type DismissiblePanelOptions = {
  sessionKey: string | null | undefined;
  onClose: () => void;
  dismissDisabled?: boolean;
};

/** Focus lifecycle for an embedded, nonmodal detail panel; this does not trap focus. */
export function useDismissiblePanel<T extends HTMLElement>({
  sessionKey,
  onClose,
  dismissDisabled = false,
}: DismissiblePanelOptions) {
  const panelRef = useRef<T>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (sessionKey == null) return;
    const element = panelRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (trigger && !element?.contains(trigger)) opener.current = trigger;
    element?.focus({ preventScroll: true });
    return () => {
      if (
        element?.contains(document.activeElement) &&
        trigger?.isConnected &&
        !element.contains(trigger)
      ) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [sessionKey]);

  const closePanel = () => {
    const element = panelRef.current;
    const trigger = opener.current;
    onClose();
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // A newly opened panel may already own focus. Do not take it back from that panel.
      if (trigger?.isConnected && (active === document.body || element?.contains(active))) {
        trigger.focus({ preventScroll: true });
      }
    });
  };

  const onKeyDown = (event: KeyboardEvent<T>) => {
    if (event.key === "Escape" && !event.defaultPrevented && !dismissDisabled) {
      event.stopPropagation();
      closePanel();
    }
  };

  return { panelRef, closePanel, onKeyDown };
}
