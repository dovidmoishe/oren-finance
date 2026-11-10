export type BrowserReason =
  | 'inactive_delegation'
  | 'unsupported_venue'
  | 'slippage_above_grant'
  | 'sells_not_allowed'
  | 'unpriced_sell';

const BROWSER_MESSAGES: Record<BrowserReason, string> = {
  inactive_delegation:
    'No active in-chat signing grant is available for this connection. The user can approve this trade in the browser.',
  unsupported_venue:
    'This quote uses a route that cannot be signed in chat. The signing grant is still active. This is not a missing signing permission. The review link is only for this route.',
  slippage_above_grant:
    'The requested slippage is above the active signing grant. The grant is still active. Lower the slippage or raise the grant, then prepare again.',
  sells_not_allowed:
    'The active signing grant does not allow sells. This is not a missing grant. Buys can still be signed in chat, or the user can approve this sell in the browser.',
  unpriced_sell:
    'This sell could not be priced for in-chat signing. The signing grant is still active. The user can approve it in the browser.',
};

export function delegatedModeDecision(input: {
  executeEnabled: boolean;
  provider: string;
  slippageBps: number;
  side: 'buy' | 'sell';
  delegation?: {
    activatedAt: Date | null;
    maxSlippageBps: number;
    allowSell: boolean;
  } | null;
  connectionCreatedAt: Date;
  sellPriced: boolean;
}): {
  delegated: boolean;
  signingGrant: 'active' | 'inactive';
  browserReason?: BrowserReason;
  message?: string;
} {
  const grant = input.delegation;
  const signingGrant =
    input.executeEnabled &&
    grant?.activatedAt &&
    input.connectionCreatedAt > grant.activatedAt
      ? 'active'
      : 'inactive';
  if (signingGrant === 'inactive')
    return {
      delegated: false,
      signingGrant,
      browserReason: 'inactive_delegation',
      message: BROWSER_MESSAGES.inactive_delegation,
    };
  let browserReason: BrowserReason | undefined;
  if (input.provider !== 'jupiter') browserReason = 'unsupported_venue';
  else if (input.slippageBps > grant!.maxSlippageBps)
    browserReason = 'slippage_above_grant';
  else if (input.side === 'sell' && !grant!.allowSell)
    browserReason = 'sells_not_allowed';
  else if (input.side === 'sell' && !input.sellPriced)
    browserReason = 'unpriced_sell';
  if (!browserReason) return { delegated: true, signingGrant };
  return {
    delegated: false,
    signingGrant,
    browserReason,
    message: BROWSER_MESSAGES[browserReason],
  };
}
