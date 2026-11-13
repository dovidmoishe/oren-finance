import { ChunkLoadRecovery } from "@/components/chunk-load-recovery";
import { PersonalizedIntl } from "@/i18n/personalized-intl";
import { AppProviders } from "../providers";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PersonalizedIntl>
      <ChunkLoadRecovery />
      <AppProviders>{children}</AppProviders>
    </PersonalizedIntl>
  );
}
