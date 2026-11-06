import { SignerGateRejection } from './signer-gate.errors';

/** Why a prepared trade cannot be signed in chat. Shown to the agent verbatim. */
export const CHAT_TRADE_ISSUES = {
  chat_trading_unavailable: 'Chat trading is not available on Oren right now.',
  buys_disabled: 'Buying in chat is not enabled on Oren right now.',
  sells_disabled: 'Selling in chat is not enabled on Oren right now.',
  unsupported_route:
    'This stock cannot be traded in chat on its current route. Try again shortly.',
  chat_trading_inactive:
    'Chat trading is off for this account. Turn it on in Oren under Settings › Agent connections.',
  reconnect_required:
    'Chat trading was turned on after this connection was made. Reconnect Oren in your agent app to use it.',
  slippage_above_limit:
    'The requested slippage is above the limit set for chat trading.',
  sells_not_allowed:
    'Selling is not included in this account’s chat trading permission.',
  price_unavailable:
    'An independent price for this stock is unavailable, so the sell cannot be checked against your limits.',
} as const;

export type ChatTradeIssue = keyof typeof CHAT_TRADE_ISSUES;

export interface ExecutionFailure {
  code: string;
  message: string;
  retryable: boolean;
}

const GATE_FAILURES: Record<string, ExecutionFailure> = {
  disabled: {
    code: 'chat_trading_unavailable',
    message: CHAT_TRADE_ISSUES.chat_trading_unavailable,
    retryable: false,
  },
  over_budget: {
    code: 'over_limit',
    message:
      'This trade is above the per-trade or daily limit for chat trading.',
    retryable: false,
  },
  inactive_delegation: {
    code: 'chat_trading_inactive',
    message: CHAT_TRADE_ISSUES.chat_trading_inactive,
    retryable: false,
  },
  unsupported_route: {
    code: 'unsupported_route',
    message: CHAT_TRADE_ISSUES.unsupported_route,
    retryable: true,
  },
  gate_rejected: {
    code: 'rejected_by_policy',
    message:
      'Oren’s signer declined this trade because it did not pass the trading policy checks.',
    retryable: false,
  },
  pending: {
    code: 'pending',
    message:
      'Signing is still in progress. Check the trade status before retrying.',
    retryable: false,
  },
};

const AUTHORIZATION_FAILURES: Record<string, ExecutionFailure> = {
  'Independent trade authorization is disabled for this user': {
    code: 'not_enabled_for_user',
    message: 'Chat trading is not enabled for this account yet.',
    retryable: false,
  },
  'Independent trade authorization is inactive': {
    code: 'chat_trading_inactive',
    message: CHAT_TRADE_ISSUES.chat_trading_inactive,
    retryable: false,
  },
  'Independent trade budget exceeded': GATE_FAILURES.over_budget,
};

/** A fixed, safe reason for a failed execution; provider details never leak. */
export function executionFailure(error: unknown): ExecutionFailure {
  if (error instanceof SignerGateRejection)
    return (
      GATE_FAILURES[error.code] ?? {
        code: 'signer_unavailable',
        message: 'Oren’s signer is unavailable right now. Try again shortly.',
        retryable: true,
      }
    );
  const known =
    error instanceof Error ? AUTHORIZATION_FAILURES[error.message] : undefined;
  return (
    known ?? {
      code: 'execution_failed',
      message:
        'The trade could not be signed. Nothing was sent. Prepare a new trade to try again.',
      retryable: true,
    }
  );
}
