"use client";

import {
  Activity01Icon,
  BellIcon,
  Briefcase01Icon,
  Cancel01Icon,
  ChatBotIcon,
  Home01Icon,
  MarketAnalysisIcon,
  Settings02Icon,
  SafeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WalletButton } from "./wallet-button";
import { Button, cn } from "@/components/ui";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home01Icon },
  { href: "/markets", label: "Market", icon: MarketAnalysisIcon },
  { href: "/vault", label: "Vault", icon: SafeIcon },
  { href: "/activity", label: "Activity", icon: Activity01Icon },
];

function Icon({ icon, className, size = 18 }: { icon: IconSvgElement; className?: string; size?: number }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

function AgentPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open ? (
        <aside className="w-[min(calc(100vw-2.5rem),360px)] rounded-[24px] border border-border bg-panel shadow-[0_24px_70px_rgba(23,23,23,0.14)]">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-foreground text-white">
                <Icon icon={ChatBotIcon} size={18} />
              </div>
              <div>
                <p className="font-display font-semibold">Oren Agent</p>
                <p className="text-xs text-muted">Ready when you need it</p>
              </div>
            </div>
            <Button aria-label="Close agent" onClick={() => setOpen(false)} size="icon" variant="ghost">
              <Icon icon={Cancel01Icon} size={18} />
            </Button>
          </div>
          <div className="max-h-[420px] space-y-4 overflow-y-auto p-4">
            <div className="rounded-[18px] border border-border bg-background p-4 text-sm text-muted">
              Agent chat and structured action artifacts land in phase 12.
            </div>
            <div className="rounded-[18px] border border-border bg-background p-4">
              <p className="text-xs uppercase text-muted">Safety rule</p>
              <p className="mt-2 text-sm font-medium">Oren proposes. You review. Your wallet signs.</p>
            </div>
          </div>
        </aside>
      ) : null}
      <Button
        aria-expanded={open}
        aria-label="Open agent"
        className="h-12 w-12 rounded-[18px] shadow-[0_18px_44px_rgba(23,23,23,0.18)]"
        onClick={() => setOpen((current) => !current)}
        size="icon"
        variant="primary"
      >
        <Icon icon={ChatBotIcon} size={20} />
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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
      <main className="min-w-0 px-4 py-8 sm:px-6">
        {children}
      </main>
      <AgentPanel />
    </div>
  );
}
