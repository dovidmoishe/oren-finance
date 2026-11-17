import { ChunkLoadRecovery } from "@/components/chunk-load-recovery";
import { AppShell } from "@/components/shell/app-shell";
import { PersonalizedIntl } from "@/i18n/personalized-intl";
import { AppProviders } from "../providers";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  // Account restoration and portfolio requests have their own loading states.
  // Keep the server-rendered shell visible instead of adding a segment-wide
  // loading.tsx that hides the entire app during startup.
  return (
    <PersonalizedIntl>
      <ChunkLoadRecovery />
      <AppProviders>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </PersonalizedIntl>
  );
}
