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
): PlatformFee | undefined {
  if (!expected) {
    if (raw?.feeBps) throw new QuoteExpiredError('Unexpected platform fee');
    return undefined;
  }
  if (!raw || raw.feeBps !== expected.bps || !/^\d+$/.test(raw.amount))
    throw new QuoteExpiredError(
      'Provider did not return the requested platform fee',
    );
  return { bps: raw.feeBps, amountRaw: raw.amount, mint: USDC_MINT };
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
