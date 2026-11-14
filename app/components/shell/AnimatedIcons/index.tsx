"use client";

import { CalendarDays, LockKeyhole, Settings, Trophy } from "lucide-react";
import { motion, type Variants } from "motion/react";

export type NavigationIconName = "portfolio" | "markets" | "activity" | "vault" | "calendar" | "leaderboard" | "settings";

const MotionSettings = motion.create(Settings);
const MotionLock = motion.create(LockKeyhole);
const MotionCalendar = motion.create(CalendarDays);
const MotionTrophy = motion.create(Trophy);
const settle = { type: "spring", stiffness: 220, damping: 20 } as const;
const stroke: Variants = { rest: { pathLength: 1 }, hover: { pathLength: [0, 1], transition: { duration: 0.4, ease: "easeOut" } } };

/** Original motion behaviours with Lucide geometry. See LICENSE for the SVG shapes. */
export function AnimatedNavigationIcon({ name }: { name: NavigationIconName }) {
  const props = { size: 20, strokeWidth: 1.8, "aria-hidden": true, className: "shrink-0" } as const;

  if (name === "settings") return <MotionSettings {...props} transition={settle} variants={{ rest: { rotate: 0 }, hover: { rotate: 90 } }} />;
  if (name === "vault") return <MotionLock {...props} transition={settle} variants={{ rest: { scale: 1 }, hover: { scale: 1.12 } }} />;
  if (name === "calendar") return <MotionCalendar {...props} transition={settle} variants={{ rest: { rotate: 0 }, hover: { rotate: -8 } }} />;
  if (name === "leaderboard") return <MotionTrophy {...props} transition={settle} variants={{ rest: { y: 0, rotate: 0 }, hover: { y: -2, rotate: 8 } }} />;

  return (
    <svg aria-hidden="true" className="shrink-0" fill="none" height={20} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24" width={20}>
      {name === "markets" && <>
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <motion.path d="m19 9-5 5-4-4-3 3" variants={stroke} />
      </>}
      {name === "portfolio" && <>
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <motion.g transition={settle} variants={{ rest: { y: 0 }, hover: { y: -2 } }}>
          <path d="M9 5v4m0 6v2" /><rect height="6" rx="1" width="4" x="7" y="9" />
        </motion.g>
        <motion.g transition={settle} variants={{ rest: { y: 0 }, hover: { y: 2 } }}>
          <path d="M17 3v2m0 8v3" /><rect height="8" rx="1" width="4" x="15" y="5" />
        </motion.g>
      </>}
      {name === "activity" && <>
        <motion.g transition={settle} variants={{ rest: { x: 0 }, hover: { x: 2 } }}><path d="m16 3 4 4-4 4M20 7H4" /></motion.g>
        <motion.g transition={settle} variants={{ rest: { x: 0 }, hover: { x: -2 } }}><path d="m8 21-4-4 4-4M4 17h16" /></motion.g>
      </>}
    </svg>
  );
}
