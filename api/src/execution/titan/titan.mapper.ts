import { randomUUID } from 'crypto';
import type { TokenizedEquity } from '../../../types/equity';
import type { PlatformFee, Quote, TradeSide } from '../../../types/quote';
import { QUOTE_TTL_MS, USDC_MINT } from '../../config/constants';
import type { PlatformFeeConfig } from '../../config/platform-fee-config';
import { QuoteExpiredError } from '../../common/errors/provider.errors';
import { rawAmountToUi } from '../jupiter/jupiter.mapper';
import { TitanError } from './titan.errors';
import type {
  TitanQuoteResponse,
  TitanRoute,
  TitanRoutePayload,
  TitanU64,
} from './titan.types';

export interface MapTitanQuoteInput {
  platformFee?: PlatformFeeConfig;
  response: TitanQuoteResponse;
  side: TradeSide;
  assetId: string;
  ticker: string;
  variant: TokenizedEquity;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inputDecimals: number;
  outputDecimals: number;
  amountUsd: number;
  /** Requested slippage; the chosen route may not exceed it. */
  slippageBps: number;
  /** Requested input amount (raw units) — the route may not spend more. */
  amountRaw: string;
  wallet: string;
  quotedAt?: Date;
  quoteId?: string;
}

/**
 * Titan accepts integrator (user-specified) fees for every portal key and
 * rejects the whole request when fees are not enabled, so a returned quote
 * means our feeAccount/feeBps were applied. `route.platformFee` is Titan's own
 * routing-platform fee (Titan charges none), not ours, and is normally empty.
 * Fail closed when the route would not write to our fee account, or when Titan
 * reports a routing fee we did not expect.
 */
export function titanUserFee(
  input: Pick<
    MapTitanQuoteInput,
    'platformFee' | 'inputMint' | 'outputMint' | 'amountRaw'
  >,
  route: TitanRoute,
  providerId: string,
): PlatformFee | undefined {
  const expected = input.platformFee;
  const routing = route.platformFee;
  const routingBps = routing ? (routing.feeBps ?? routing.fee_bps ?? 0) : 0;
  const routingAmount = routing
    ? u64ToString(routing.amount, 'platformFee.amount')
    : '0';
  // Accept an echo of our own fee; reject any other routing-platform charge.
  if (
    (routingBps > 0 || routingAmount !== '0') &&
    (!expected || routingBps !== expected.bps)
  )
    throw new QuoteExpiredError('Unexpected platform fee');
  if (!expected) return undefined;
  if (!(expected.bps > 0 && expected.bps < 10_000))
    throw new QuoteExpiredError('Invalid platform fee configuration');
  const paysFee = route.instructions.some((ix) =>
    ix.a.some((meta) => meta.p === expected.account && meta.w && !meta.s),
  );
  if (!paysFee)
    throw new QuoteExpiredError(
      `Titan route ${providerId} does not pay the requested platform fee`,
    );
  const bps = BigInt(expected.bps);
  let amountRaw: bigint;
  if (input.inputMint === USDC_MINT) {
    // Buys: fee is taken from the requested USDC input (feeFromInputMint).
    amountRaw = (BigInt(input.amountRaw) * bps) / 10_000n;
  } else if (input.outputMint === USDC_MINT) {
    // Sells: outAmount is already net of the output fee; recover the gross.
    const net = BigInt(u64ToString(route.outAmount, 'outAmount'));
    amountRaw = (net * bps) / (10_000n - bps);
  } else {
    throw new QuoteExpiredError('Platform fees require a USDC pair');
  }
  return {
    bps: expected.bps,
    amountRaw: amountRaw.toString(),
    mint: USDC_MINT,
  };
}

/**
 * Reject a Titan response that does not match what we asked for. Any
 * mismatch is a hard error (the router then uses Jupiter): wrong mints,
 * a different requested amount, a route that spends more than requested,
 * a route with wider slippage than requested, or mint decimals that differ
 * from our catalog (which would make every displayed amount wrong).
 */
export function validateTitanResponse(
  input: Pick<
    MapTitanQuoteInput,
    | 'inputMint'
    | 'outputMint'
    | 'amountRaw'
    | 'slippageBps'
    | 'inputDecimals'
    | 'outputDecimals'
  >,
  response: TitanQuoteResponse,
  route: TitanRoute,
  providerId: string,
): void {
  const fail = (why: string): never => {
    throw new TitanError('invalid_response', `Titan ${providerId}: ${why}`);
  };
  if (response.inputMint !== input.inputMint) {
    fail(`inputMint ${String(response.inputMint)} != ${input.inputMint}`);
  }
  if (response.outputMint !== input.outputMint) {
    fail(`outputMint ${String(response.outputMint)} != ${input.outputMint}`);
  }
  const requested = BigInt(input.amountRaw);
  if (
    response.amount !== undefined &&
    BigInt(u64ToString(response.amount, 'amount')) !== requested
  ) {
    fail(`amount ${String(response.amount)} != ${input.amountRaw}`);
  }
  const inAmount = BigInt(u64ToString(route.inAmount, 'inAmount'));
  if (inAmount > requested) {
    fail(`route spends ${inAmount} > requested ${requested}`);
  }
  if (inAmount <= 0n) fail('route inAmount is 0');
  if (
    typeof route.slippageBps !== 'number' ||
    !Number.isFinite(route.slippageBps) ||
    route.slippageBps < 0 ||
    route.slippageBps > input.slippageBps
  ) {
    fail(
      `route slippage ${String(route.slippageBps)} bps exceeds requested ${input.slippageBps}`,
    );
  }
  const metaIn = response.metadata?.inputMintDecimals;
  const metaOut = response.metadata?.outputMintDecimals;
  if (typeof metaIn === 'number' && metaIn !== input.inputDecimals) {
    fail(`input decimals ${metaIn} != catalog ${input.inputDecimals}`);
  }
  if (typeof metaOut === 'number' && metaOut !== input.outputDecimals) {
    fail(`output decimals ${metaOut} != catalog ${input.outputDecimals}`);
  }
}

/** Normalise a Titan u64 (JSON number or string) to a decimal string. */
export function u64ToString(
  value: TitanU64 | undefined,
  field: string,
): string {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new TitanError(
    'invalid_response',
    `Titan ${field} is not a valid u64: ${String(value)}`,
  );
}

export function optionalU64ToNumber(
  value: TitanU64 | undefined,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Pick the route Titan recommends (metadata.ExpectedWinner — the best
 * slippage-adjusted route). Titan's docs say not to re-sort by outAmount.
 */
export function selectTitanWinner(response: TitanQuoteResponse): {
  providerId: string;
  route: TitanRoute;
} {
  const quotes = response.quotes ?? {};
  const named =
    response.metadata?.ExpectedWinner ?? response.metadata?.expectedWinner;
  let providerId = typeof named === 'string' ? named : undefined;
  if (!providerId) {
    const ids = Object.keys(quotes);
    // No recommendation: only accept an unambiguous single route.
    if (ids.length === 1) providerId = ids[0];
  }
  const route = providerId ? quotes[providerId] : undefined;
  if (!providerId || !route) {
    throw new TitanError(
      Object.keys(quotes).length === 0 ? 'no_route' : 'invalid_response',
      `Titan ExpectedWinner ${String(named)} not present in quotes`,
    );
  }
  if (!Array.isArray(route.instructions) || route.instructions.length === 0) {
    throw new TitanError(
      'invalid_response',
      `Titan route ${providerId} has no instructions`,
    );
  }
  return { providerId, route };
}

/** Estimated price impact (%) from Titan's reference USD prices, else 0. */
export function estimatePriceImpactPercent(
  response: TitanQuoteResponse,
  inUi: number,
  outUi: number,
): number {
  const inPx = response.metadata?.inputPriceUSD;
  const outPx = response.metadata?.outputPriceUSD;
  if (
    typeof inPx !== 'number' ||
    typeof outPx !== 'number' ||
    !(inPx > 0) ||
    !(outPx > 0) ||
    !(inUi > 0)
  ) {
    return 0;
  }
  const impact = (1 - (outUi * outPx) / (inUi * inPx)) * 100;
  return Number.isFinite(impact) ? Math.max(0, impact) : 0;
}

/**
 * Map Titan's recommended route into the domain Quote. `provider` is
 * `titan:<providerId>`; `routePayload` keeps everything needed to build the
 * transaction later (route, its ALTs, wallet, quote time).
 */
export function mapTitanQuoteToDomain(input: MapTitanQuoteInput): Quote {
  const now = input.quotedAt ?? new Date();
  const { providerId, route } = selectTitanWinner(input.response);
  validateTitanResponse(input, input.response, route, providerId);

  const platformFee = titanUserFee(input, route, providerId);
  // A buy's input budget includes its USDC fee, never an additional debit.
  const inAmountRaw =
    platformFee && input.inputMint === USDC_MINT
      ? input.amountRaw
      : u64ToString(route.inAmount, 'inAmount');
  const outAmountRaw = u64ToString(route.outAmount, 'outAmount');
  const inputAmount = rawAmountToUi(inAmountRaw, input.inputDecimals);
  const outputAmount = rawAmountToUi(outAmountRaw, input.outputDecimals);
  if (!(outputAmount > 0)) {
    throw new TitanError(
      'no_route',
      `Titan route ${providerId} outAmount is 0`,
    );
  }

  let estimatedPriceUsd = 0;
  if (input.side === 'buy' && outputAmount > 0) {
    estimatedPriceUsd = input.amountUsd / outputAmount;
  } else if (input.side === 'sell' && outputAmount > 0) {
    estimatedPriceUsd = outputAmount / (inputAmount || 1);
  }

  const needed = new Set(route.addressLookupTables ?? []);
  const alts = (input.response.alts ?? []).filter((alt) => needed.has(alt.p));

  const payload: TitanRoutePayload = {
    kind: 'titan',
    quoteId: input.response.id,
    providerId,
    route,
    alts,
    wallet: input.wallet,
    quotedAtMs: now.getTime(),
    inAmountRaw,
    outAmountRaw,
    amountRaw: input.amountRaw,
    requestedSlippageBps: input.slippageBps,
    inputDecimals: input.inputDecimals,
    outputDecimals: input.outputDecimals,
  };

  return {
    id: input.quoteId ?? randomUUID(),
    side: input.side,
    assetId: input.assetId,
    ticker: input.ticker,
    variant: input.variant,
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inputSymbol: input.inputSymbol,
    outputSymbol: input.outputSymbol,
    inputAmount,
    outputAmount,
    estimatedPriceUsd,
    amountUsd: input.amountUsd,
    priceImpactPercent: estimatePriceImpactPercent(
      input.response,
      inputAmount,
      outputAmount,
    ),
    // Route slippage is what the instructions enforce (validated ≤ request).
    slippageBps: route.slippageBps,
    provider: `titan:${providerId}`,
    routePayload: payload,
    ...(platformFee
      ? { platformFee, platformFeeAccount: input.platformFee!.account }
      : {}),
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS),
    quotedAt: now,
  };
}

export function isTitanPayload(value: unknown): value is TitanRoutePayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'titan'
  );
}

export function isTitanQuote(quote: Quote): boolean {
  return isTitanPayload(quote.routePayload);
}
