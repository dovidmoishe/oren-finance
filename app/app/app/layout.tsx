import { AppProviders } from "../providers";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
