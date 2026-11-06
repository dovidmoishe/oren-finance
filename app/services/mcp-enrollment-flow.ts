/** Keep the pending interaction, never an arbitrary return URL. */
export function mcpEnrollmentLinks(uid: unknown) {
  const valid = typeof uid === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(uid);
  return {
    settings: valid ? `/settings/mcp?connection=${encodeURIComponent(uid)}` : "/settings/mcp",
    connection: valid ? `/connect/mcp?uid=${encodeURIComponent(uid)}` : undefined,
  };
}
