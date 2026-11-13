"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useT } from "@/i18n/i18n";

export const MIN_COPILOT_WIDTH = 304;
export const MAX_COPILOT_WIDTH = 560;

export function CopilotResizeHandle({ width, maxWidth, onResize, onDragChange }: {
  width: number;
  maxWidth: number;
  onResize: (width: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const t = useT();
  const drag = useRef<{ pointerId: number; x: number; width: number; direction: number }>(null);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, width, direction };
    onDragChange(true);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    onResize(active.width + (active.x - event.clientX) * active.direction);
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    onDragChange(false);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
    const widths: Record<string, number> = {
      ArrowLeft: width + step * direction,
      ArrowRight: width - step * direction,
      Home: MIN_COPILOT_WIDTH,
      End: maxWidth,
    };
    if (!Object.hasOwn(widths, event.key)) return;
    event.preventDefault();
    onResize(widths[event.key]);
  }

  return (
    <div
      aria-controls="oren-agent-panel"
      aria-label={t("agent.resize")}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={MIN_COPILOT_WIDTH}
      aria-valuenow={width}
      className="group absolute inset-y-0 start-0 z-30 hidden w-3 touch-none cursor-col-resize items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-focus lg:flex"
      onKeyDown={resizeWithKeyboard}
      onLostPointerCapture={stop}
      onPointerCancel={stop}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      role="separator"
      tabIndex={0}
      title={t("agent.resize")}
    >
      <span aria-hidden="true" className="h-10 w-1 rounded-full bg-border-strong group-hover:bg-muted group-focus-visible:bg-muted" />
    </div>
  );
}
