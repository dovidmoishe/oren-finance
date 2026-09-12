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
