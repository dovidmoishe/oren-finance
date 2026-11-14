import { SettingsPanel } from "@/components/settings/settings-panel";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsPanel>{children}</SettingsPanel>;
}
