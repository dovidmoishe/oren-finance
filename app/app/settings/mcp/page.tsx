import { McpConnections } from "./connections";
import { mcpEnrollmentLinks } from "@/services/mcp-enrollment-flow";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ connection?: string | string[] }>;
}) {
  const { connection } = await searchParams;
  return <McpConnections connectionUid={mcpEnrollmentLinks(connection).connection ? connection as string : undefined} />;
}
