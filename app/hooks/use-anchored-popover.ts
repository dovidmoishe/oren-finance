"use client";

import { useEffect, useRef, type ToggleEvent } from "react";

/** Keep native popovers attached to their trigger during layout and scroll changes. */
export function useAnchoredPopover() {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function onBeforeToggle(event: ToggleEvent<HTMLDivElement>) {
    if (event.newState === "open") event.currentTarget.style.visibility = "hidden";
  }

  function onToggle(event: ToggleEvent<HTMLDivElement>) {
    cancelAnimationFrame(frame.current);
    if (event.newState !== "open") return;

    function position() {
      const button = trigger.current;
      const popover = menu.current;
      if (!button || !popover?.matches(":popover-open")) return;

      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const right = left + (viewport?.width ?? document.documentElement.clientWidth) - 16;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
      const below = Math.max(0, bottom - rect.bottom - 8);
      const above = Math.max(0, rect.top - top - 8);
      const placeAbove = below < Math.min(popover.scrollHeight, 200) && above > below;

      popover.style.maxWidth = Math.max(0, right - left) + "px";
      popover.style.maxHeight = (placeAbove ? above : below) + "px";
      popover.style.left = Math.max(left, Math.min(rect.right - popover.offsetWidth, right - popover.offsetWidth)) + "px";
      popover.style.top = Math.max(top, placeAbove ? rect.top - popover.offsetHeight - 8 : rect.bottom + 8) + "px";
      popover.style.visibility = "visible";
      // Grid transitions and dragging move the button without resizing it.
      frame.current = requestAnimationFrame(position);
    }

    position();
  }

  return { trigger, menu, onBeforeToggle, onToggle };
}
