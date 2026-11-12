import { AppShell } from "@/components/shell";
import { PersonalizedIntl } from "@/i18n/personalized-intl";
import { AppProviders } from "../providers";

// The shell stays mounted across /app navigations. `loading.tsx` replaces only
// the page body, so the header, menus, and agent panel do not flash.
export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PersonalizedIntl>
      <AppProviders>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </PersonalizedIntl>
  );
}
