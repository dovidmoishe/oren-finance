"use client";

import {
  Calendar01Icon, ChartNoAxesCombinedIcon, ExchangeDollarIcon, LockKeyholeIcon,
  MarketAnalysisIcon, Menu01Icon, PanelLeftCloseIcon, PanelLeftOpenIcon,
  Search01Icon, Settings01Icon, TrophyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { OrenLogo } from "@/components/brand/oren-logo";
import { LanguageMenu } from "@/components/language/language-menu";
import { PendingApprovalNotice } from "@/components/trading/pending-approval-notice";
import { cn } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n/i18n";
import { useAgentStore } from "@/store";
import { AccountMenu } from "./account-menu";
import { AppSearch } from "./app-search";
import { CopilotResizeHandle, MAX_COPILOT_WIDTH, MIN_COPILOT_WIDTH } from "./copilot-resize-handle";

const AgentPanel = dynamic(() => import("@/components/agent/agent-panel").then((mod) => mod.AgentPanel), { ssr: false });
const DepositModal = dynamic(() => import("@/components/portfolio/deposit-dashboard").then((mod) => mod.DepositModal), { ssr: false });

const portfolio = { href: "/app", label: "nav.portfolio", icon: MarketAnalysisIcon } as const;
const markets = { href: "/app/markets", label: "nav.markets", icon: ChartNoAxesCombinedIcon } as const;
const settings = { href: "/app/settings/connections", label: "nav.settings", icon: Settings01Icon } as const;
const navigation: { href: string; label: MessageKey; icon: IconSvgElement }[] = [
  portfolio,
  markets,
  { href: "/app/activity", label: "common.activityTitle", icon: ExchangeDollarIcon },
  { href: "/app/vault", label: "nav.vault", icon: LockKeyholeIcon },
  { href: "/app/calendar", label: "calendar.title", icon: Calendar01Icon },
  { href: "/app/leaderboard", label: "nav.leaderboard", icon: TrophyIcon },
];

const headerButton = "inline-flex h-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus lg:h-9 pointer-coarse:h-11";
const iconButton = cn(headerButton, "w-10 lg:w-9 pointer-coarse:w-11");
const navRow = "flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm hover:bg-black/[0.035] hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-11";

function Icon({ icon, size = 18 }: { icon: IconSvgElement; size?: number }) {
  return <HugeiconsIcon aria-hidden="true" className="shrink-0" icon={icon} size={size} strokeWidth={1.7} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const agentOpen = useAgentStore((state) => state.panelOpen && state.hydrated);
  const agentExpanded = useAgentStore((state) => state.expanded);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const [collapsed, setCollapsed] = useState(false);
  const [copilotWidth, setCopilotWidth] = useState(360);
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
    const isActive = item.href === active?.href;
    return (
      <Link
        aria-current={isActive ? "page" : undefined}
        className={cn(navRow, isActive ? "bg-panel font-semibold text-foreground shadow-[0_2px_8px_rgb(23_23_23/.05)] ring-1 ring-border/70 [&>svg]:text-[#7160b8]" : "font-medium text-muted", compact && "justify-center px-0")}
        href={item.href}
        key={item.href}
        onClick={() => mobileMenu.current?.hidePopover()}
        title={compact ? t(item.label) : undefined}
      >
        <HugeiconsIcon aria-hidden="true" className="shrink-0" icon={item.icon} size={19} strokeWidth={isActive ? 2.2 : 1.65} />
        <span className={compact ? "sr-only" : undefined}>{t(item.label)}</span>
      </Link>
    );
  }

  return (
    <div ref={shell} style={{ "--copilot-preferred-width": width + "px" } as CSSProperties} className={cn(
      "mx-auto min-h-dvh overflow-x-clip bg-panel-subtle text-foreground lg:grid lg:grid-cols-[var(--nav-width)_minmax(0,1fr)_var(--copilot-width)] lg:p-3 lg:[--app-shell-inset:0.75rem] motion-reduce:transition-none [--app-header-bottom:calc(var(--app-nav-height)+var(--app-shell-inset,0px))]",
      collapsed ? "lg:[--nav-width:4rem]" : "lg:[--nav-width:14rem] xl:[--nav-width:15.5rem]",
      agentOpen && agentExpanded ? "lg:[--copilot-width:1fr]" : docked ? "lg:[--copilot-width:var(--copilot-preferred-width)]" : "lg:[--copilot-width:0rem]",
      resizing ? "select-none lg:transition-none" : cn(
        "lg:[transition:grid-template-columns_var(--panel-close-dur)_var(--panel-ease)]",
        docked && "lg:[transition-duration:var(--panel-open-dur)]",
      ),
    )}>
      <a className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:p-3" href="#app-content">{t("nav.skipToContent")}</a>
      <aside ref={sidebar} className="sticky top-3 hidden h-[calc(100dvh-1.5rem)] min-h-0 flex-col pe-3 ps-2 pb-2 lg:flex">
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
          "mb-4 flex min-h-9 items-center gap-2 rounded-lg border border-border bg-panel text-start text-sm text-muted shadow-xs hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus",
          collapsed ? "justify-center" : "px-2.5",
        )} onClick={() => search.current?.showModal()} title={t("markets.searchLabel")} type="button">
          <Icon icon={Search01Icon} size={16} />
          {!collapsed && <><span className="flex-1">{t("nav.search")}</span><kbd className="rounded bg-panel-subtle px-1.5 font-mono text-xs">/</kbd></>}
        </button>
        <nav aria-label={t("nav.navigation")} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-0.5">
          {navigation.map((item) => navigationLink(item, collapsed))}
          <div className="mt-auto pt-4">{navigationLink(settings, collapsed)}</div>
        </nav>
      </aside>

      <div className={cn("min-h-dvh min-w-0 bg-panel lg:col-start-2 lg:row-start-1 lg:min-h-[calc(100dvh-1.5rem)] lg:rounded-[22px] lg:border lg:border-border/80 lg:shadow-[0_4px_24px_rgb(23_23_23/.025)]", agentOpen && agentExpanded && "lg:hidden")}>
        <header ref={header} className="sticky top-0 z-30 flex min-h-[var(--app-nav-height)] items-center gap-1.5 border-b border-border/70 bg-panel px-2.5 sm:gap-2.5 sm:px-5 lg:rounded-t-[22px] lg:border-b-0">
          <button aria-label={t("nav.navigation")} className={cn(iconButton, "lg:hidden")} popoverTarget={menuId} type="button"><Icon icon={Menu01Icon} size={20} /></button>
          <div className="fixed inset-x-2 top-[var(--app-header-bottom)] bottom-auto m-0 max-h-[calc(100dvh-var(--app-nav-height)-1rem)] overflow-y-auto rounded-xl border border-border bg-panel p-2 text-foreground shadow-xl lg:hidden" id={menuId} popover="auto" ref={mobileMenu}>
            <nav aria-label={t("nav.navigation")} className="grid gap-1">
              {navigation.map((item) => navigationLink(item))}
              <div className="mt-1 border-t border-border pt-1">{navigationLink(settings)}</div>
            </nav>
          </div>
          {active === portfolio || pathname === markets.href
            ? <h1 className="min-w-0 flex-1 truncate font-display text-[1.2rem] font-bold tracking-tight sm:text-[1.25rem]">{title}</h1>
            : <span className="min-w-0 flex-1 truncate font-display text-[1.2rem] font-bold tracking-tight sm:text-[1.25rem]">{title}</span>}
          <div aria-label={t("nav.yourAccount")} className="flex min-w-0 items-center gap-0.5 sm:gap-2">
            <button aria-haspopup="dialog" aria-label={t("markets.searchLabel")} className={cn(iconButton, "lg:hidden")} onClick={() => search.current?.showModal()} type="button"><Icon icon={Search01Icon} /></button>
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
          className={cn("@container min-w-0 px-3 pb-10 pt-3 sm:px-7 sm:pt-5 lg:pt-4", agentOpen && "max-lg:invisible")}
          id="app-content"
          tabIndex={-1}
        >
          <PendingApprovalNotice key={pathname} />
          {children}
        </main>
      </div>
      <div className={cn("contents lg:sticky lg:top-3 lg:row-start-1 lg:block lg:min-w-0 lg:self-start", agentExpanded ? "lg:col-span-2 lg:col-start-2" : "lg:col-start-3", docked && "lg:ps-3")}>
        {docked && <CopilotResizeHandle
          maxWidth={maxCopilotWidth}
          onDragChange={setResizing}
          onResize={(next) => setCopilotWidth(Math.max(MIN_COPILOT_WIDTH, Math.min(maxCopilotWidth, next)))}
          width={width}
        />}
        <AgentPanel />
      </div>
      <AppSearch dialog={search} />
      <DepositModal />
    </div>
  );
}
