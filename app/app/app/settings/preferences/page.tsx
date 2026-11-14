import type { Metadata } from "next";
import { PreferencesSettings } from "@/components/settings/preferences-settings";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = { title: "Preferences | Oren" };

export default function PreferencesPage() {
  return <AppShell><PreferencesSettings /></AppShell>;
}
