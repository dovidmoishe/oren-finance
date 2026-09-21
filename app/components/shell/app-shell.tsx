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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentPanel } from "@/components/agent/agent-panel";
import { OrenLogo } from "@/components/brand/oren-logo";
import { WalletButton } from "./wallet-button";
import { Button, cn } from "@/components/ui";
import { useAgentStore } from "@/store";

const navItems = [
  { href: "/app", label: "Dashboard", icon: Home01Icon },
  { href: "/app/calendar", label: "Calendar", icon: Calendar03Icon },
  { href: "/app/leaderboard", label: "Leaderboard", icon: RankingIcon },
  { href: "/app/markets", label: "Market", icon: MarketAnalysisIcon },
  { href: "/app/volume", label: "Volume", icon: MarketAnalysisIcon },
  { href: "/app/vault", label: "Vault", icon: SafeIcon },
  { href: "/app/activity", label: "Activity", icon: Activity01Icon },
];

function Icon({ icon, className, size = 18 }: { icon: IconSvgElement; className?: string; size?: number }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const agentOpen = useAgentStore((state) => state.panelOpen && state.hydrated);
  const agentExpanded = useAgentStore((state) => state.expanded);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const reserveSidecarGutter = agentOpen && !agentExpanded;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto grid min-h-[72px] max-w-[1540px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6">
          <Link className="flex items-center gap-2" href="/app">
            <OrenLogo className="h-8 w-8" size={32} />
            <span className="font-display text-lg font-semibold">Oren</span>
          </Link>
          <nav className="flex items-stretch justify-center gap-3 overflow-x-auto sm:gap-8">
            {navItems.map((item) => {
              const active =
                item.href === "/app"
                  ? pathname === "/app"
                  : item.href === "/app/markets"
                    ? pathname === "/app/markets" || pathname.startsWith("/app/stocks/")
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
      <main className={cn("agent-shell-main min-w-0 px-4 py-8 sm:px-6", reserveSidecarGutter && "2xl:pr-[456px]")}>
        {children}
      </main>
      <AgentPanel />
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] px-4 sm:px-6">
        <div className="mx-auto flex max-w-[1540px] justify-end">
          <Button
            aria-label="Open Oren"
            className="pointer-events-auto h-14 w-14 overflow-visible rounded-[20px] bg-foreground text-white shadow-[0_18px_50px_rgba(23,23,23,0.24)] transition-[background-color,transform] hover:scale-[1.04] hover:bg-black/85"
            id="oren-agent-launcher"
            onClick={() => setPanelOpen(true)}
            size="icon"
            variant="primary"
          >
            <OrenLogo size={38} />
          </Button>
        </div>
      </div>
    </div>
  );
}
