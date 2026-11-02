/** Identity the agent can prove. Model arguments are never a caller. */
export interface DripCaller {
  userId?: string;
  email?: string;
  walletAddress?: string;
}

export interface DripAccessConfig {
  enabled: boolean;
  userIds: readonly string[];
  emails: readonly string[];
  wallets: readonly string[];
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
  if (
    config.userIds.length + config.emails.length + config.wallets.length ===
    0
  ) {
    return false;
  }

  const userId = caller.userId?.trim();
  const email = caller.email?.trim().toLowerCase();
  const wallet = caller.walletAddress?.trim();
  if (userId && config.userIds.includes(userId)) return true;
  if (email && config.emails.includes(email)) return true;
  if (wallet && config.wallets.includes(wallet)) return true;
  return false;
}
