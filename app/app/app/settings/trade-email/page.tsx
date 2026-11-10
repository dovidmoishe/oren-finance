import type { Metadata } from 'next';
import { AppShell } from '@/components/shell';
import { TradeEmailPreferences } from '@/components/settings/trade-email-preferences';

export const metadata: Metadata = { title: 'Trade email receipts | Oren' };

export default function TradeEmailSettingsPage() {
  return (
    <AppShell>
      <TradeEmailPreferences />
    </AppShell>
  );
}
