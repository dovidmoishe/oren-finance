import Image from "next/image";
import { Monitor as MonitorIcon } from "lucide-react";

import { mcpConnectorForKind } from "@/services/mcp-connector";

export const agentClient = mcpConnectorForKind;

export function AgentClientLogo({ kind, size = 28 }: { kind?: string | null; size?: number }) {
  const client = agentClient(kind);
  return client ? <Image alt="" src={client.logo} width={size} height={size} />
    : <MonitorIcon size={size} aria-hidden="true" />;
}
