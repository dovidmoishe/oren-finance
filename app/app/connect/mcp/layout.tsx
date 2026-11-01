import { AppProviders } from '../../providers';

export default function McpConnectLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
