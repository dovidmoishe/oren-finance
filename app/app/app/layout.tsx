import { ChunkLoadRecovery } from "@/components/chunk-load-recovery";
import { AppShell } from "@/components/shell/app-shell";
import { PersonalizedIntl } from "@/i18n/personalized-intl";
import { AppProviders } from "../providers";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PersonalizedIntl>
      <ChunkLoadRecovery />
      <AppProviders>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </PersonalizedIntl>
  );
}
