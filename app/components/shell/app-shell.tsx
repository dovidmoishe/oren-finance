"use client";

import {
  Activity01Icon,
  Calendar03Icon,
  Home01Icon,
  MarketAnalysisIcon,
  RankingIcon,
  SafeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentPanel } from "@/components/agent/agent-panel";
import { WalletButton } from "./wallet-button";
import { cn } from "@/components/ui";
import { useAgentStore } from "@/store";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home01Icon },
  { href: "/calendar", label: "Calendar", icon: Calendar03Icon },
  { href: "/leaderboard", label: "Leaderboard", icon: RankingIcon },
  { href: "/markets", label: "Market", icon: MarketAnalysisIcon },
  { href: "/vault", label: "Vault", icon: SafeIcon },
  { href: "/activity", label: "Activity", icon: Activity01Icon },
];

function Icon({ icon, className, size = 18 }: { icon: IconSvgElement; className?: string; size?: number }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const agentOpen = useAgentStore((state) => state.panelOpen && state.hydrated);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto grid min-h-[72px] max-w-[1540px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6">
          <Link className="flex items-center gap-2" href="/">
            <Image
              alt="Oren"
              className="h-8 w-8 object-contain"
              height={32}
              priority
              src="/oren-logo.png"
              width={32}
            />
            <span className="font-display text-lg font-semibold">Oren</span>
          </Link>
          <nav className="flex items-stretch justify-center gap-3 overflow-x-auto sm:gap-8">
            {navItems.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : item.href === "/markets"
                    ? pathname === "/markets" || pathname.startsWith("/stocks/")
                    : pathname.startsWith(item.href);

              return (
                <Link
                  className={cn(
                    "relative inline-flex min-h-[72px] shrink-0 items-center gap-1.5 px-1 text-sm font-semibold text-muted transition-colors",
                    active ? "text-foreground" : "hover:text-foreground",
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="hidden sm:block" icon={item.icon} size={14} />
                  {item.label}
                  {active ? <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-foreground" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 justify-self-end">
            <WalletButton />
          </div>
        </div>
      </header>
      <main className={cn("agent-shell-main min-w-0 px-4 py-8 sm:px-6", agentOpen && "2xl:pr-[456px]")}>
        {children}
      </main>
      <AgentPanel />
    </div>
  );
}
