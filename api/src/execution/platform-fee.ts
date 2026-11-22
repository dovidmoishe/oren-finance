import type { Quote, PlatformFee } from '../../types/quote';
import type { PlatformFeeConfig } from '../config/platform-fee-config';
import { USDC_MINT } from '../config/constants';
import { QuoteExpiredError } from '../common/errors/provider.errors';

export function usdcPair(inputMint: string, outputMint: string): boolean {
  return (inputMint === USDC_MINT) !== (outputMint === USDC_MINT);
}

/** Never accept an upstream silently dropping or changing the requested fee. */
export function mappedPlatformFee(
  raw: { amount: string; feeBps: number } | null | undefined,
  expected: PlatformFeeConfig | undefined,
  /** Jupiter ExactIn reports output-mint fees even for USDC-input fees. */
  usdcInputAmountRaw?: string,
): PlatformFee | undefined {
  if (!expected) {
    if (raw?.feeBps) throw new QuoteExpiredError('Unexpected platform fee');
    return undefined;
  }
  if (!raw || raw.feeBps !== expected.bps || !/^\d+$/.test(raw.amount))
    throw new QuoteExpiredError(
      'Provider did not return the requested platform fee',
    );
  if (usdcInputAmountRaw !== undefined && !/^\d+$/.test(usdcInputAmountRaw))
    throw new QuoteExpiredError('Invalid platform fee input amount');
  return {
    bps: raw.feeBps,
    amountRaw:
      usdcInputAmountRaw === undefined
        ? raw.amount
        : (
            (BigInt(usdcInputAmountRaw) * BigInt(raw.feeBps)) /
            10_000n
          ).toString(),
    mint: USDC_MINT,
  };
}

export function quoteFeeConfig(quote: Quote): PlatformFeeConfig | undefined {
  if (quote.platformFee?.bps && !quote.platformFeeAccount)
    throw new QuoteExpiredError('Platform fee destination is missing');
  return quote.platformFee &&
    quote.platformFee.bps > 0 &&
    quote.platformFeeAccount
    ? { bps: quote.platformFee.bps, account: quote.platformFeeAccount }
    : undefined;
}

export function sameFee(a: Quote, b: Quote): boolean {
  return (
    (a.platformFee?.bps ?? 0) === (b.platformFee?.bps ?? 0) &&
    a.platformFeeAccount === b.platformFeeAccount
  );
}
