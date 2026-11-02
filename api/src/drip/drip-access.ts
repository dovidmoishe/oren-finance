/** Identity the agent can prove. Model arguments are never a caller. */
export interface DripCaller {
  userId?: string;
  email?: string;
  walletAddress?: string;
}

export interface DripAccessConfig {
  enabled: boolean;
  publicResearch?: boolean;
  userIds: readonly string[];
  emails: readonly string[];
}

/**
 * Tools are registered only when the flag is on and the caller matches an
 * allowlist entry. An empty allowlist denies every caller.
 */
export function dripToolsEnabled(
  config: DripAccessConfig,
  caller: DripCaller,
): boolean {
  if (!config.enabled) return false;
  if (config.publicResearch && caller.userId) return true;
  if (config.userIds.length + config.emails.length === 0) {
    return false;
  }

  const userId = caller.userId?.trim();
  const email = caller.email?.trim().toLowerCase();
  if (userId && config.userIds.includes(userId)) return true;
  if (email && config.emails.includes(email)) return true;
  return false;
}
