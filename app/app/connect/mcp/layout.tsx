import { ChunkLoadRecovery } from '@/components/chunk-load-recovery';
import { PersonalizedIntl } from '@/i18n/personalized-intl';
import { AppProviders } from '../../providers';
import type { Metadata } from 'next';
import { PRIVATE_ROBOTS } from '@/lib/seo';

export const metadata: Metadata = { title: 'Connect your agent', robots: PRIVATE_ROBOTS };

export default function McpConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <PersonalizedIntl>
      <ChunkLoadRecovery />
      <AppProviders>{children}</AppProviders>
    </PersonalizedIntl>
  );
}
