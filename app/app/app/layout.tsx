import { ChunkLoadRecovery } from "@/components/chunk-load-recovery";
import { AppShell } from "@/components/shell/app-shell";
import { PersonalizedIntl } from "@/i18n/personalized-intl";
import { AppProviders } from "../providers";
import { StartupRecovery } from "@/components/startup-recovery";
import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/lib/seo";

// Personal by default. Public market pages opt back in through pageMetadata.
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  // Account restoration and portfolio requests have their own loading states.
  // Keep the server-rendered shell visible instead of adding a segment-wide
  // loading.tsx that hides the entire app during startup.
  return (
    <PersonalizedIntl>
      <StartupRecovery />
      <ChunkLoadRecovery />
      <AppProviders>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </PersonalizedIntl>
  );
}
