import type { Metadata } from "next";
import { AccountSettings } from "@/components/settings/account-settings";

export const metadata: Metadata = { title: "Settings | Oren" };

export default function SettingsPage() {
  return <AccountSettings />;
}
