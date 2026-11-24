import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, TrendingUp, ListFilter, Users, Link2, ChartLine, Shield, Activity, LogOut, Menu, X, ArrowUpRight, Layers, CalendarDays, LockKeyhole } from "lucide-react";
import { post } from "./api";
import { AuthScreen } from "./auth";
import { hasPermission } from "./model";
import { useAuth } from "./state";
import { Icon, Loading } from "./ui";

const navigation = [
  {
    label: "Workspace",
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
      {
        to: "/funnel",
        label: "Activation funnel",
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
    ],
  },
  {
    label: "Operations",
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
      {
        to: "/coverage",
        label: "Data coverage",
        icon: Layers,
        permission: "reports.read",
      },
    ],
  },
  {
    label: "Administration",
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
export const pageInfo: Record<string, [string, string]> = {
  "/": ["Overview", "A little perspective on how Oren is growing."],
  "/traffic": ["Traffic", "Every visit is part of a bigger story."],
  "/funnel": [
    "Activation funnel",
    "From discovery to a useful first interaction.",
  ],
  "/retention": ["Retention", "See which research accounts come back."],
  "/campaigns": [
    "Campaigns",
    "Understand the paths bringing accounts to Oren.",
  ],
  "/users": ["Connected accounts", "Accounts with a recorded MCP connection."],
  "/connections": [
    "Agent connections",
    "A read-only view of connected clients and scopes.",
  ],
  "/trades": [
    "Trade activity",
    "Follow agent intents from preparation to confirmation.",
  ],
  "/coverage": [
    "Data coverage",
    "Know what each number can—and cannot—tell you.",
  ],
  "/accounts": ["Team & access", "Give your team the access they need."],
  "/audit": ["Audit log", "A record of admin access and account changes."],
  "/security": ["Password & security", "Keep your admin account secure."],
};

export function Workspace() {
  const { session, loading, clear } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const path = useRouterState({ select: (state) => state.location.pathname });
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
    if (mobileOpen)
      sidebarRef.current
        ?.querySelector<HTMLButtonElement>(".mobile-close")
        ?.focus();
    else if (wasOpen.current) menuRef.current?.focus();
    wasOpen.current = mobileOpen;
  }, [mobileOpen]);
  useEffect(() => {
    setMobileOpen(false);
    document.title = `${pageInfo[path]?.[0] || "Workspace"} · Oren Admin`;
  }, [path]);
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
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        inert={isMobile && !mobileOpen}
        className={`sidebar ${mobileOpen ? "open" : ""}`}
      >
        <div className="sidebar-brand">
          <Link to="/" className="brand">
            <img src="/oren-mark.svg" alt="" />
            <span>
              oren<span className="brand-dot">.</span>
            </span>
          </Link>
          <span className="sidebar-context">Admin</span>
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <Icon icon={X} />
          </button>
        </div>
        <nav aria-label="Admin navigation">
          {navigation.map((group) => {
            const items = group.items.filter((item) =>
              permitted(item.permission),
            );
            return items.length ? (
              <div className="nav-group" key={group.label}>
                <span className="nav-label">{group.label}</span>
                {items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`nav-item ${path === item.to ? "active" : ""}`}
                    aria-current={path === item.to ? "page" : undefined}
                  >
                    <Icon icon={item.icon} size={16} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            ) : null;
          })}
        </nav>
        <div className="sidebar-bottom">
          <a
            href="https://oren.finance"
            target="_blank"
            rel="noreferrer"
            className="view-product"
          >
            View Oren
            <Icon icon={ArrowUpRight} size={16} />
          </a>
          <div className="user-card">
            <span className="user-avatar">
              {session.email.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong title={session.email}>{session.email}</strong>
              <span>{session.isMaster ? "Master admin" : "Team member"}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              disabled={loggingOut}
              onClick={() => void logout()}
            >
              <Icon icon={LogOut} size={18} />
            </button>
          </div>
          {logoutError && (
            <p className="logout-error" role="alert">
              {logoutError}
            </p>
          )}
        </div>
      </aside>
      <div className="main-shell" inert={isMobile && mobileOpen}>
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              ref={menuRef}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Icon icon={Menu} />
            </button>
            <span className="breadcrumb">Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{pageInfo[path]?.[0] || "Workspace"}</strong>
          </div>
          <span className="private-label">
            <Icon icon={Shield} size={15} />
            Private workspace
          </span>
        </header>
        <main id="main" className="main-content">
          {import.meta.env.DEV && session.preview && (
            <div className="sample-banner">
              Local fixture · sample data · no production connection
            </div>
          )}
          <div className="page-heading">
            <h1>{pageInfo[path]?.[0] || "Workspace"}</h1>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
