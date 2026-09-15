export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number = 502,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class TokensApiUnavailableError extends ProviderError {
  constructor(message = 'Tokens API unavailable', cause?: unknown) {
    super(message, 'TOKENS_UNAVAILABLE', 502, cause);
    this.name = 'TokensApiUnavailableError';
  }
}

export class TokensNotFoundError extends ProviderError {
  constructor(message = 'Asset not found', cause?: unknown) {
    super(message, 'TOKENS_NOT_FOUND', 404, cause);
    this.name = 'TokensNotFoundError';
  }
}

export class TokensBadRequestError extends ProviderError {
  constructor(message = 'Invalid Tokens API request', cause?: unknown) {
    super(message, 'TOKENS_BAD_REQUEST', 400, cause);
    this.name = 'TokensBadRequestError';
  }
}

export class AlchemyUnavailableError extends ProviderError {
  constructor(message = 'Alchemy unavailable', cause?: unknown) {
    super(message, 'ALCHEMY_UNAVAILABLE', 502, cause);
    this.name = 'AlchemyUnavailableError';
  }
}

export class InvalidWalletAddressError extends ProviderError {
  constructor(message = 'Invalid Solana wallet address') {
    super(message, 'INVALID_WALLET', 400);
    this.name = 'InvalidWalletAddressError';
  }
}

export class JupiterUnavailableError extends ProviderError {
  constructor(message = 'Jupiter unavailable', cause?: unknown) {
    super(message, 'JUPITER_UNAVAILABLE', 502, cause);
    this.name = 'JupiterUnavailableError';
  }
}

export class JupiterBadRequestError extends ProviderError {
  constructor(message = 'Invalid Jupiter request', cause?: unknown) {
    super(message, 'JUPITER_BAD_REQUEST', 400, cause);
    this.name = 'JupiterBadRequestError';
  }
}

export class QuoteExpiredError extends ProviderError {
  constructor(
    message = 'Quote expired or not found. Refresh the quote or basket and try again.',
  ) {
    super(message, 'QUOTE_EXPIRED', 400);
    this.name = 'QuoteExpiredError';
  }
}

export class BasketExpiredError extends ProviderError {
  constructor(
    message = 'Basket expired or not found. Create a fresh basket and try again.',
  ) {
    super(message, 'BASKET_EXPIRED', 400);
    this.name = 'BasketExpiredError';
  }
}

export class LimitOrderExpiredError extends ProviderError {
  constructor(
    message = 'Limit order proposal expired or not found. Create a fresh proposal and try again.',
  ) {
    super(message, 'LIMIT_ORDER_EXPIRED', 400);
    this.name = 'LimitOrderExpiredError';
  }
}

export class ExecutionNotFoundError extends ProviderError {
  constructor(message = 'Execution not found') {
    super(message, 'EXECUTION_NOT_FOUND', 404);
    this.name = 'ExecutionNotFoundError';
  }
}

export class AgentUnavailableError extends ProviderError {
  constructor(message = 'Agent unavailable', cause?: unknown) {
    super(message, 'AGENT_UNAVAILABLE', 503, cause);
    this.name = 'AgentUnavailableError';
  }
}
