import { AppProviders } from '../../providers';

export default function McpSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppProviders>{children}</AppProviders>;
}
