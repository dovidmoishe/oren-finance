import type { Metadata } from "next";
import { AppShell } from "@/components/shell";
import { AgentConnections } from "@/components/settings/agent-connections";

export const metadata: Metadata = { title: "Agent connections | Oren" };

export default function ConnectionsPage() {
  return <AppShell><AgentConnections /></AppShell>;
}
