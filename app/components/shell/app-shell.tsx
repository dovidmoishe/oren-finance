"use client";

import {
  Menu as MenuIcon,
  PanelLeftClose as PanelLeftCloseIcon,
  PanelLeftOpen as PanelLeftOpenIcon,
  Search as SearchIcon,
  type LucideIcon,
} from "lucide-react";
import { InterfaceIcon } from "@/components/ui/interface-icon";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { OrenLogo } from "@/components/brand/oren-logo";
import { LanguageMenu } from "@/components/language/language-menu";
import { PendingApprovalNotice } from "@/components/trading/pending-approval-notice";
import { cn } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n/i18n";
import { useAgentStore } from "@/store";
import { AccountMenu } from "./account-menu";
import { AppSearch } from "./app-search";
import { NavigationLink } from "./navigation-link";
import type { NavigationIconName } from "./AnimatedIcons";
import { CopilotResizeHandle, MAX_COPILOT_WIDTH, MIN_COPILOT_WIDTH } from "./copilot-resize-handle";

const AgentPanel = dynamic(() => import("@/components/agent/agent-panel").then((mod) => mod.AgentPanel), { ssr: false });
const DepositModal = dynamic(() => import("@/components/portfolio/deposit-dashboard").then((mod) => mod.DepositModal), { ssr: false });

const portfolio = { href: "/app", label: "nav.portfolio", icon: "portfolio" } as const;
const markets = { href: "/app/markets", label: "nav.markets", icon: "markets" } as const;
const settings = { href: "/app/settings", label: "nav.settings", icon: "settings" } as const;
const navigation: { href: string; label: MessageKey; icon: NavigationIconName }[] = [
  portfolio,
  markets,
  { href: "/app/activity", label: "common.activityTitle", icon: "activity" },
  { href: "/app/vault", label: "nav.vault", icon: "vault" },
  { href: "/app/calendar", label: "calendar.title", icon: "calendar" },
  { href: "/app/leaderboard", label: "nav.leaderboard", icon: "leaderboard" },
];

const headerButton = "inline-flex h-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus lg:h-8 pointer-coarse:h-11";
const iconButton = cn(headerButton, "w-10 lg:w-8 pointer-coarse:w-11");

function Icon({ icon, size = 18 }: { icon: LucideIcon; size?: number }) {
  return <InterfaceIcon aria-hidden="true" className="shrink-0" icon={icon} size={size} strokeWidth={1.7} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { depositOpen } = useOrenAuth();
  const pathname = usePathname();
  const t = useT();
  const agentOpen = useAgentStore((state) => state.panelOpen && state.hydrated);
  const agentExpanded = useAgentStore((state) => state.expanded);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const [collapsed, setCollapsed] = useState(false);
  const [copilotWidth, setCopilotWidth] = useState(320);
  const [maxCopilotWidth, setMaxCopilotWidth] = useState(MAX_COPILOT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const mobileMenu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const search = useRef<HTMLDialogElement>(null);
  const active = pathname === "/app" || pathname === "/app/portfolio" || pathname === "/app/overview"
    ? portfolio
    : pathname.startsWith("/app/stocks/")
      ? markets
      : [...navigation.slice(1), settings].find(({ href }) => pathname === href || pathname.startsWith(href + "/"));
  const title = active ? t(active.label) : "Oren";

  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const updateHeaderBottom = () => {
      shell.current?.style.setProperty("--app-header-bottom", element.getBoundingClientRect().bottom + "px");
    };
    const observer = new ResizeObserver(updateHeaderBottom);
    observer.observe(element);
    window.addEventListener("scroll", updateHeaderBottom, { passive: true });
    window.addEventListener("resize", updateHeaderBottom);
    updateHeaderBottom();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateHeaderBottom);
      window.removeEventListener("resize", updateHeaderBottom);
    };
  }, []);

  useEffect(() => {
    const layout = shell.current;
    const navigation = sidebar.current;
    if (!layout || !navigation) return;

    const observer = new ResizeObserver(() => {
      if (!navigation.offsetWidth) return;
      const { paddingLeft, paddingRight } = getComputedStyle(layout);
      const available = layout.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight) - navigation.offsetWidth - 432;
      setMaxCopilotWidth(Math.max(MIN_COPILOT_WIDTH, Math.min(MAX_COPILOT_WIDTH, available)));
    });
    observer.observe(layout);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, []);

  const width = Math.min(copilotWidth, maxCopilotWidth);
  const docked = agentOpen && !agentExpanded;

  function navigationLink(item: (typeof navigation)[number], compact = false) {
    return (
      <NavigationLink
        active={item.href === active?.href}
        compact={compact}
        href={item.href}
        icon={item.icon}
        key={item.href}
        label={t(item.label)}
        onNavigate={() => mobileMenu.current?.hidePopover()}
      />
    );
  }

  return (
    <div ref={shell} style={{ "--copilot-preferred-width": width + "px" } as CSSProperties} className={cn(
      "mx-auto min-h-dvh overflow-x-clip bg-panel-subtle text-foreground [&_h2]:font-medium [&_h2]:tracking-[-0.025em] [&_h3]:font-medium [&_h3]:tracking-[-0.015em] lg:grid lg:grid-cols-[var(--nav-width)_minmax(0,1fr)_var(--copilot-width)] lg:[--app-shell-inset:0px] motion-reduce:transition-none [--app-header-bottom:calc(var(--app-nav-height)+var(--app-shell-inset,0px))]",
      collapsed ? "lg:[--nav-width:3.5rem]" : "lg:[--nav-width:12.5rem] xl:[--nav-width:13.5rem]",
      agentOpen && agentExpanded ? "lg:[--copilot-width:1fr]" : docked ? "lg:[--copilot-width:var(--copilot-preferred-width)]" : "lg:[--copilot-width:0rem]",
      resizing ? "select-none lg:transition-none" : cn(
        "lg:[transition:grid-template-columns_var(--panel-close-dur)_var(--panel-ease)]",
        docked && "lg:[transition-duration:var(--panel-open-dur)]",
      ),
    )}>
      <a className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:p-3" href="#app-content">{t("nav.skipToContent")}</a>
      <aside ref={sidebar} className="sticky top-0 hidden h-dvh min-h-0 flex-col border-e border-border px-3 pb-3 lg:flex">
        <div className={cn("flex h-[var(--app-nav-height)] shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-1")}>
          {collapsed ? null : (
            <Link className="flex items-center gap-2 font-display text-[1.2rem] font-bold tracking-tight" href="/app">
              <OrenLogo className="shrink-0" size={30} />
              Oren
            </Link>
          )}
          <button aria-expanded={!collapsed} aria-label={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")} className={iconButton} onClick={() => setCollapsed(!collapsed)} title={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")} type="button">
            <Icon icon={collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon} size={17} />
          </button>
        </div>
        <button aria-haspopup="dialog" aria-label={t("markets.searchLabel")} className={cn(
          "mb-2 flex min-h-9 items-center gap-2 rounded-lg border border-border bg-panel text-start text-sm text-muted hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-11",
          collapsed ? "justify-center" : "px-2.5",
        )} onClick={() => search.current?.showModal()} title={t("markets.searchLabel")} type="button">
          <Icon icon={SearchIcon} size={16} />
          {!collapsed && <><span className="flex-1">{t("nav.search")}</span><kbd className="rounded bg-panel-subtle px-1.5 font-mono text-xs">/</kbd></>}
        </button>
        <nav aria-label={t("nav.navigation")} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-0.5">
          {navigation.map((item) => navigationLink(item, collapsed))}
          <div className="mt-auto pt-4">{navigationLink(settings, collapsed)}</div>
        </nav>
      </aside>

      <div className={cn("min-h-dvh min-w-0 bg-panel lg:col-start-2 lg:row-start-1 lg:min-h-dvh", agentOpen && agentExpanded && "lg:hidden")}>
        <header ref={header} className="sticky top-0 z-30 flex min-h-[var(--app-nav-height)] items-center gap-1.5 border-b border-border/70 bg-panel px-2.5 sm:gap-2.5 sm:px-5">
          <button aria-label={t("nav.navigation")} className={cn(iconButton, "lg:hidden")} popoverTarget={menuId} type="button"><Icon icon={MenuIcon} size={20} /></button>
          <div className="fixed inset-x-2 top-[var(--app-header-bottom)] bottom-auto m-0 max-h-[calc(100dvh-var(--app-nav-height)-1rem)] overflow-y-auto rounded-xl border border-border bg-panel p-2 text-foreground shadow-xl lg:hidden" id={menuId} popover="auto" ref={mobileMenu}>
            <nav aria-label={t("nav.navigation")} className="grid gap-1">
              {navigation.map((item) => navigationLink(item))}
              <div className="mt-1 border-t border-border pt-1">{navigationLink(settings)}</div>
            </nav>
          </div>
          {active === portfolio || pathname === markets.href
            ? <h1 className="min-w-0 flex-1 truncate font-display text-[1.125rem] font-medium tracking-[-0.025em]">{title}</h1>
            : <span className="min-w-0 flex-1 truncate font-display text-[1.125rem] font-medium tracking-[-0.025em]">{title}</span>}
          <div aria-label={t("nav.yourAccount")} className="flex min-w-0 items-center gap-0.5 sm:gap-2">
            <button aria-haspopup="dialog" aria-label={t("markets.searchLabel")} className={cn(iconButton, "lg:hidden")} onClick={() => search.current?.showModal()} type="button"><Icon icon={SearchIcon} /></button>
            <LanguageMenu />
            <button
              aria-controls="oren-agent-panel"
              aria-expanded={agentOpen}
              aria-label={t(agentOpen ? "agent.close" : "agent.ask")}
              className={cn(headerButton, "gap-1.5 whitespace-nowrap border border-accent-lavender/65 bg-accent-lavender/15 max-sm:w-10 sm:px-3 pointer-coarse:max-sm:w-11", agentOpen && "border-foreground/25 bg-panel-subtle text-foreground")}
              id="oren-agent-launcher"
              onClick={() => setPanelOpen(!agentOpen)}
              title={t(agentOpen ? "agent.close" : "agent.ask")}
              type="button"
            >
              <OrenLogo size={24} />
              <span className="hidden text-xs font-semibold sm:inline">{t("agent.ask")}</span>
            </button>
            <AccountMenu />
          </div>
        </header>
        <main
          className={cn("@container min-w-0 px-3 pb-8 pt-3 sm:px-6 sm:pt-6 xl:px-8 xl:pt-8", agentOpen && "max-lg:invisible")}
          id="app-content"
          tabIndex={-1}
        >
          <PendingApprovalNotice key={pathname} />
          {children}
        </main>
      </div>
      <div className={cn("contents lg:sticky lg:top-0 lg:row-start-1 lg:block lg:min-w-0 lg:self-start", agentExpanded ? "lg:col-span-2 lg:col-start-2" : "lg:col-start-3", docked && "lg:border-s lg:border-border")}>
        {docked && <CopilotResizeHandle
          maxWidth={maxCopilotWidth}
          onDragChange={setResizing}
          onResize={(next) => setCopilotWidth(Math.max(MIN_COPILOT_WIDTH, Math.min(maxCopilotWidth, next)))}
          width={width}
        />}
        <AgentPanel />
      </div>
      <AppSearch dialog={search} />
      {depositOpen ? <DepositModal /> : null}
    </div>
  );
}
