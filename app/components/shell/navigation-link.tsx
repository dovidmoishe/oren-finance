"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/components/ui";
import { AnimatedNavigationIcon, type NavigationIconName } from "./AnimatedIcons";

const MotionLink = motion.create(Link);

export function NavigationLink({ href, label, icon, active, compact, onNavigate }: {
  href: string;
  label: string;
  icon: NavigationIconName;
  active: boolean;
  compact: boolean;
  onNavigate: () => void;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <MotionLink
      animate="rest"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-xl px-3.5 text-sm font-medium outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus",
        active ? "bg-panel text-foreground shadow-[0_2px_8px_rgb(23_23_23/.05)] ring-1 ring-border/80 [&_svg]:text-[#6652b3]" : "text-muted hover:bg-panel/70 hover:text-foreground",
        compact && "justify-center px-0",
      )}
      href={href}
      initial="rest"
      onClick={onNavigate}
      title={compact ? label : undefined}
      whileFocus={reducedMotion ? undefined : "hover"}
      whileHover={reducedMotion ? undefined : "hover"}
    >
      <AnimatedNavigationIcon name={icon} />
      <span className={cn(compact && "sr-only", active && "font-semibold")}>{label}</span>
    </MotionLink>
  );
}
