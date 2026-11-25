"use client";

import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import * as m from "motion/react-m";
import { cn } from "@/components/ui";
import { AnimatedNavigationIcon, type NavigationIconName } from "./AnimatedIcons";

// Motion's lightweight entry points: importing anything from `motion/react`
// also evaluates its full `motion` component and every feature (drag, layout,
// projection) into the first bundle. `m` animates once the shell's LazyMotion
// loads the features; the same framer-motion copy backs `motion/react-m`.
const MotionLink = m.create(Link);

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
        "flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-normal outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus lg:min-h-9 pointer-coarse:min-h-11",
        active ? "bg-nav-active text-foreground [&_svg]:text-brand" : "text-muted hover:bg-panel/70 hover:text-foreground",
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
      <span className={cn(compact && "sr-only", active && "font-medium")}>{label}</span>
    </MotionLink>
  );
}
