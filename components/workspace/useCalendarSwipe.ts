"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/** Horizontal touch gestures leave vertical scrolling and ordinary calendar taps intact. */
export function useCalendarSwipe(onChangeMonth: (direction: number) => void) {
  const start = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const suppressClick = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      suppressClick.current = false;
      start.current = event.isPrimary && event.pointerType !== "mouse" && event.button === 0
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp }
        : null;
    },
    onPointerCancel() { start.current = null; },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const origin = start.current;
      start.current = null;
      if (!origin || origin.id !== event.pointerId) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (event.timeStamp - origin.at > 1200 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      suppressClick.current = true;
      onChangeMonth(dx < 0 ? 1 : -1);
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      if (event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
