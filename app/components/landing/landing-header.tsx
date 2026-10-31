"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./landing-hero.module.css";

export function LandingHeader({ children }: { children: ReactNode }) {
  const top = useRef<HTMLSpanElement>(null);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!top.current || !header.current) return;
    const node = header.current;
    const observer = new IntersectionObserver(([entry]) => {
      node.dataset.scrolled = String(!entry.isIntersecting);
    });
    observer.observe(top.current);
    return () => observer.disconnect();
  }, []);

  return <>
    <span ref={top} aria-hidden className={styles.scrollSentinel} />
    <header ref={header} className={styles.navigation} data-scrolled="false">{children}</header>
  </>;
}
