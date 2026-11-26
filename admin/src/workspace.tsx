import { iconButton } from "./control-styles";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  LogOut,
  Menu,
  X,
  FolderClosed,
  BriefcaseBusiness,
  ChevronDown,
  LockKeyhole,
  ScrollText,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedSidebarIcon } from "@oren/animated-icons";
import { post } from "./api";
import { AuthScreen } from "./auth";
import { hasPermission } from "./model";
import { useAuth } from "./state";
import { ThemeControl } from "./theme-control";
import { Badge, Icon, Loading } from "./ui";

const MotionLink = motion.create(Link);

interface NavItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  permission: string;
}
interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}
const sections: { label: string; entries: (NavItem | NavGroup)[] }[] = [
  {
    label: "Main",
    entries: [
      {
        to: "/",
        label: "Overview",
        icon: LayoutDashboard,
        permission: "reports.read",
      },
      {
        to: "/traffic",
        label: "Traffic",
        icon: TrendingUp,
        permission: "reports.read",
      },
      {
        label: "Reports",
        icon: FolderClosed,
        items: [
          { to: "/funnel", label: "Agent setup", permission: "reports.read" },
          { to: "/retention", label: "Retention", permission: "reports.read" },
          { to: "/campaigns", label: "Campaigns", permission: "reports.read" },
          {
            to: "/coverage",
            label: "Data coverage",
            permission: "reports.read",
          },
        ],
      },
      {
        label: "Operations",
        icon: BriefcaseBusiness,
        items: [
          {
            to: "/users",
            label: "Connected accounts",
            permission: "dashboard.access",
          },
          {
            to: "/connections",
            label: "Agent connections",
            permission: "dashboard.access",
          },
          {
            to: "/trades",
            label: "Trade activity",
            permission: "dashboard.access",
          },
        ],
      },
    ],
  },
  {
    label: "Settings",
    entries: [
      {
        to: "/accounts",
        label: "Team & access",
        icon: Users,
        permission: "master",
      },
      {
        to: "/audit",
        label: "Audit log",
        icon: ScrollText,
        permission: "master",
      },
      {
        to: "/security",
        label: "Password & security",
        icon: LockKeyhole,
        permission: "self",
      },
    ],
  },
];
const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/traffic": "Traffic",
  "/funnel": "Agent setup",
  "/retention": "Retention",
  "/campaigns": "Campaigns",
  "/users": "Connected accounts",
  "/connections": "Agent connections",
  "/trades": "Trade activity",
  "/coverage": "Data coverage",
  "/accounts": "Team & access",
  "/audit": "Audit log",
  "/security": "Password & security",
};
const navLink =
  "flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors pointer-coarse:h-11";
// Not iconButton: its inline-flex would override `hidden` on wide screens.
const mobileButton =
  "hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel hover:text-foreground mobile:inline-flex";

export function Workspace() {
  const reducedMotion = useReducedMotion();
  const { session, loading, clear } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const path = useRouterState({ select: (state) => state.location.pathname });
  const title = pageTitles[path] ?? "Workspace";
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const change = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (mobileOpen) closeRef.current?.focus();
    else if (wasOpen.current) menuRef.current?.focus();
    wasOpen.current = mobileOpen;
  }, [mobileOpen]);
  useEffect(() => {
    setMobileOpen(false);
  }, [path]);
  useEffect(() => {
    document.title = `${title} · Oren Admin`;
  }, [title]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  if (loading) return <Loading label="Loading workspace…" />;
  if (!session) return <AuthScreen />;
  if (session.mustChangePassword) return <AuthScreen changing />;
  const permitted = (permission: string) =>
    permission === "self"
      ? true
      : permission === "master"
        ? session.isMaster
        : hasPermission(session, permission);
  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await post("auth/session/logout");
      clear();
    } catch {
      setLogoutError("Sign out failed. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  }
  const topLink = (item: NavItem) => {
    const active = path === item.to;
    return (
      <MotionLink
        initial="rest"
        animate="rest"
        whileHover={reducedMotion ? undefined : "hover"}
        whileFocus={reducedMotion ? undefined : "hover"}
        key={item.to}
        to={item.to}
        onClick={() => setMobileOpen(false)}
        className={`${navLink} ${active ? "bg-nav-active font-medium text-foreground [&_svg]:text-brand" : "text-muted hover:bg-panel hover:text-foreground"}`}
        aria-current={active ? "page" : undefined}
      >
        {item.icon && <AnimatedSidebarIcon icon={item.icon} size={17} />}
        <span>{item.label}</span>
      </MotionLink>
    );
  };
  return (
    <div className="min-h-dvh bg-canvas">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        href="#main"
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-20 cursor-pointer bg-black/40 min-[701px]:hidden"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        inert={isMobile && !mobileOpen}
        className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-border bg-surface text-foreground mobile:w-[272px] motion-safe:transition-transform ${mobileOpen ? "translate-x-0 shadow-pop" : "mobile:-translate-x-full"}`}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/oren-mark.svg" alt="" className="size-7" />
            <span className="text-[17px] font-semibold tracking-tight">
              Oren
            </span>
            <span className="rounded-md bg-panel px-1.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-border ring-inset">
              Admin
            </span>
          </Link>
          <button
            ref={closeRef}
            className={`${mobileButton} ml-auto`}
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <Icon icon={X} />
          </button>
        </div>
        <nav
          aria-label="Admin navigation"
          className="flex-1 overflow-y-auto px-3 pb-4"
        >
          {sections.map((section) => {
            const entries = section.entries.flatMap(
              (entry): (NavItem | NavGroup)[] => {
              if (!("items" in entry))
                return permitted(entry.permission) ? [entry] : [];
              const items = entry.items.filter((item) =>
                permitted(item.permission),
              );
              return items.length ? [{ ...entry, items }] : [];
              },
            );
            if (entries.length === 0) return null;
            return (
              <div className="mt-5 first:mt-1" key={section.label}>
                <p className="mb-1.5 px-3 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
                  {section.label}
                </p>
                <div className="grid gap-0.5">
                  {entries.map((entry) => {
                    if (!("items" in entry)) return topLink(entry);
                    const active = entry.items.some(
                      (item) => item.to === path,
                    );
                    return (
                      <details
                        className="group"
                        key={entry.label}
                        open={active || undefined}
                      >
                        <summary
                          className={`${navLink} cursor-pointer list-none hover:bg-panel hover:text-foreground [&::-webkit-details-marker]:hidden ${active ? "font-medium text-foreground" : "text-muted"}`}
                        >
                          <Icon icon={entry.icon} size={17} />
                          <span className="flex-1">{entry.label}</span>
                          <span className="text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none">
                            <Icon icon={ChevronDown} size={14} />
                          </span>
                        </summary>
                        <div className="mt-0.5 mb-1 ml-[21px] grid gap-0.5 border-l border-border pl-3">
                          {entry.items.map((item) => {
                            const current = path === item.to;
                            return (
                              <Link
                                key={item.to}
                                to={item.to}
                                onClick={() => setMobileOpen(false)}
                                aria-current={current ? "page" : undefined}
                                className={`relative flex h-8 items-center rounded-lg px-3 text-[13px] transition-colors pointer-coarse:h-10 ${current ? "bg-nav-active font-medium text-foreground before:absolute before:inset-y-1.5 before:-left-[14px] before:w-0.5 before:rounded-full before:bg-brand" : "text-muted hover:bg-panel hover:text-foreground"}`}
                              >
                                {item.label}
                              </Link>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="grid shrink-0 gap-3 border-t border-border p-3">
          <ThemeControl />
          <div className="flex min-w-0 items-center gap-2.5 px-1">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand/12 text-[13px] font-semibold text-brand">
              {session.email.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <strong
                className="block truncate text-[13px] font-medium"
                title={session.email}
              >
                {session.email}
              </strong>
              <span className="block text-[11px] text-muted">
                {session.isMaster ? "Master admin" : "Admin"}
              </span>
            </div>
            <button
              className={iconButton}
              aria-label="Sign out"
              title="Sign out"
              disabled={loggingOut}
              onClick={() => void logout()}
            >
              <Icon icon={LogOut} size={17} />
            </button>
          </div>
          {logoutError && (
            <p className="px-1 text-xs text-error" role="alert">
              {logoutError}
            </p>
          )}
        </div>
      </aside>
      <div
        className="min-w-0 pl-[248px] mobile:pl-0"
        inert={isMobile && mobileOpen}
      >
        <header className="sticky top-0 z-10 border-b border-border bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-8 mobile:px-4">
            <button
              className={`${mobileButton} -ml-1`}
              ref={menuRef}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Icon icon={Menu} />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
              {title}
            </h1>
            {import.meta.env.DEV && session.preview && (
              <Badge tone="amber" dot>
                Sample data
              </Badge>
            )}
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto grid w-full max-w-[1440px] scroll-mt-16 gap-5 px-8 py-6 outline-none mobile:gap-4 mobile:px-4 mobile:py-4 [&>*]:min-w-0"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
