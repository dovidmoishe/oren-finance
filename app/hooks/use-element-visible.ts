"use client";

import { useEffect, useState, type RefObject } from "react";

/** Includes CSS/container-query hiding, clipping and background tabs. */
export function useElementVisible(ref: RefObject<Element | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let intersects = false;
    const sync = () => setVisible(intersects && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersects = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
      sync();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ref]);
  return visible;
}
