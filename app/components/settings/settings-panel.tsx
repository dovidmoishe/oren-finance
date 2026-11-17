"use client";

import { Suspense, type ReactNode } from "react";
import { Link as LinkIcon, SlidersHorizontal, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui";
import { useT } from "@/i18n/i18n";
import { mcpEnrollmentLinks } from "@/services/mcp-enrollment-flow";

const sections = [
  { href: "/app/settings", label: "settings.account", icon: UserRound },
  { href: "/app/settings/preferences", label: "preferences.title", icon: SlidersHorizontal },
  { href: "/app/settings/connections", label: "account.agentConnections", icon: LinkIcon },
] as const;

export function SettingsLinks({ connection }: { connection?: string }) {
  const pathname = usePathname();
  const t = useT();
  const suffix = connection && mcpEnrollmentLinks(connection).connection ? `?connection=${encodeURIComponent(connection)}` : "";
  return (
    <nav aria-label={t("nav.settings")} className="flex gap-1 overflow-x-auto rounded-xl bg-panel-subtle p-1 @3xl:sticky @3xl:top-20 @3xl:flex-col @3xl:self-start">
      {sections.map(({ href, label, icon: Icon }) => (
        <Link
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-11",
            pathname === href ? "bg-panel text-foreground shadow-xs" : "text-muted hover:bg-panel/60 hover:text-foreground",
          )}
          href={href + suffix}
          key={href}
        >
          <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
          <span className="truncate">{t(label)}</span>
        </Link>
      ))}
    </nav>
  );
}

function SettingsNavigation() {
  const searchParams = useSearchParams();
  const values = searchParams.getAll("connection");
  return <SettingsLinks connection={values.length === 1 ? values[0] : undefined} />;
}

export function SettingsPanel({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-5xl pb-10">
      <header className="mb-4">
        <h1 className="sr-only">{t("nav.settings")}</h1>
        <p className="max-w-xl text-sm leading-6 text-muted">{t("settings.intro")}</p>
      </header>
      <div className="grid min-w-0 gap-4 @3xl:grid-cols-[11rem_minmax(0,1fr)] @3xl:gap-6">
        <Suspense fallback={<p className="rounded-xl bg-panel-subtle p-3 text-sm text-muted" role="status">{t("account.loading")}</p>}><SettingsNavigation /></Suspense>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
