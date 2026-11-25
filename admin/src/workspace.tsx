import { iconButton } from "./control-styles";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  TrendingUp,
  ListFilter,
  Users,
  Link2,
  ChartLine,
  Shield,
  Activity,
  LogOut,
  Menu,
  X,
  FolderClosed,
  BriefcaseBusiness,
  Settings,
  Layers,
  CalendarDays,
  ChevronDown,
  LockKeyhole,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedSidebarIcon } from "@oren/animated-icons";
import { post } from "./api";
import { AuthScreen } from "./auth";
import { hasPermission } from "./model";
import { useAuth } from "./state";
import { ThemeControl } from "./theme-control";
import { Icon, Loading } from "./ui";

const MotionLink = motion.create(Link);

const navigation = [
  {
    label: null,
    items: [
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
    ],
  },
  {
    label: "Reports",
    icon: FolderClosed,
    items: [
      {
        to: "/funnel",
        label: "Agent setup",
        icon: ListFilter,
        permission: "reports.read",
      },
      {
        to: "/retention",
        label: "Retention",
        icon: CalendarDays,
        permission: "reports.read",
      },
      {
        to: "/campaigns",
        label: "Campaigns",
        icon: ChartLine,
        permission: "reports.read",
      },
      {
        to: "/coverage",
        label: "Data coverage",
        icon: Layers,
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
        icon: Users,
        permission: "dashboard.access",
      },
      {
        to: "/connections",
        label: "Agent connections",
        icon: Link2,
        permission: "dashboard.access",
      },
      {
        to: "/trades",
        label: "Trade activity",
        icon: Activity,
        permission: "dashboard.access",
      },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    items: [
      {
        to: "/accounts",
        label: "Team & access",
        icon: Shield,
        permission: "master",
      },
      {
        to: "/audit",
        label: "Audit log",
        icon: Activity,
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
] as const;
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
    document.title = `${title} ? Oren Admin`;
  }, [title]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  if (loading) return <Loading />;
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
  return (
    <div className="min-h-dvh bg-background">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        href="#main"
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-20 cursor-pointer bg-black/35 min-[701px]:hidden"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        inert={isMobile && !mobileOpen}
        className={`fixed inset-y-0 left-0 z-30 flex w-[216px] flex-col overflow-y-auto border-r border-border bg-panel px-3 text-foreground mobile:w-60 motion-safe:transition-transform ${mobileOpen ? "translate-x-0" : "mobile:-translate-x-full"}`}
      >
        <div className="mb-3 flex min-h-16 shrink-0 items-center gap-2 px-2">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight [&>img]:size-7"
          >
            <img src="/oren-mark.svg" alt="" />
            <span>Oren Admin</span>
          </Link>
          <button
            ref={closeRef}
            className="ml-auto hidden size-9 cursor-pointer items-center justify-center rounded hover:bg-nav-active mobile:inline-flex"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <Icon icon={X} />
          </button>
        </div>
        <nav aria-label="Admin navigation" className="grid gap-1">
          {navigation.map((group) => {
            const items = group.items.filter((item) =>
              permitted(item.permission),
            );
            if (items.length === 0) return null;
            const links = items.map((item) => (
              <MotionLink
                initial="rest"
                animate="rest"
                whileHover={reducedMotion ? undefined : "hover"}
                whileFocus={reducedMotion ? undefined : "hover"}
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-sm pointer-coarse:min-h-11 ${path === item.to ? "bg-nav-active font-medium text-foreground [&_svg]:text-brand" : "text-muted hover:bg-nav-active hover:text-foreground"}`}
                aria-current={path === item.to ? "page" : undefined}
              >
                <AnimatedSidebarIcon icon={item.icon} size={16} />
                <span>{item.label}</span>
              </MotionLink>
            ));
            if (!group.label)
              return (
                <div className="grid gap-1" key="primary">
                  {links}
                </div>
              );
            const active = items.some((item) => item.to === path);
            return (
              <details className="group" key={group.label} open={active}>
                <summary
                  className={`flex min-h-9 cursor-pointer list-none items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-nav-active hover:text-foreground pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden ${active ? "font-medium text-foreground" : "text-muted"}`}
                >
                  <Icon icon={group.icon} size={16} />
                  <span className="flex-1">{group.label}</span>
                  <span className="group-open:rotate-180">
                    <Icon icon={ChevronDown} size={14} />
                  </span>
                </summary>
                <div className="mt-1 ml-[19px] grid gap-1 border-l border-border pl-1.5">
                  {links}
                </div>
              </details>
            );
          })}
        </nav>
        <div className="mt-auto pt-4">
          <div className="flex min-w-0 items-center gap-2 border-t border-border px-1 py-4 [&>div]:min-w-0 [&>div]:flex-1 [&_strong]:block [&_strong]:truncate [&_strong]:text-xs">
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-nav-active text-xs font-semibold">
              {session.email.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong title={session.email}>{session.email}</strong>
            </div>
            <button
              className={iconButton}
              aria-label="Sign out"
              title="Sign out"
              disabled={loggingOut}
              onClick={() => void logout()}
            >
              <Icon icon={LogOut} size={18} />
            </button>
          </div>
          {logoutError && (
            <p className="pb-3 text-xs text-error" role="alert">
              {logoutError}
            </p>
          )}
        </div>
      </aside>
      <div
        className="min-w-0 ml-[216px] mobile:ml-0"
        inert={isMobile && mobileOpen}
      >
        <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-border bg-surface px-8 mobile:px-4">
          <button
            className="hidden size-9 cursor-pointer items-center justify-center rounded-lg hover:bg-panel mobile:inline-flex"
            ref={menuRef}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Icon icon={Menu} />
          </button>
          <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
            {title}
          </h1>
          <ThemeControl />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] scroll-mt-16 px-8 py-7 mobile:px-4 mobile:py-5"
        >
          {import.meta.env.DEV && session.preview && (
            <p className="mb-5 text-xs text-muted">Sample data</p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
