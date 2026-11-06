import { Injectable, Logger, Optional } from '@nestjs/common';
import type { TokenizedEquity } from '../../types/equity';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { TokensBadRequestError } from '../common/errors/provider.errors';

interface ParsedMintInfo {
  value: { data?: { parsed?: { info?: { decimals?: unknown } } } } | null;
}

/**
 * Stock token decimals from the mint itself. The catalog sometimes omits them,
 * and guessing (the old USDC fallback of 6) mis-sized 8-decimal xStock sells by
 * 100x. Mint decimals never change, so each mint is read once.
 */
@Injectable()
export class StockDecimals {
  private readonly logger = new Logger(StockDecimals.name);
  private readonly cache = new Map<string, number>();

  constructor(@Optional() private readonly rpc?: AlchemyClient) {}

  async forVariant(variant: TokenizedEquity): Promise<TokenizedEquity> {
    const onChain = await this.read(variant.mint);
    if (onChain !== undefined) {
      if (variant.decimals !== undefined && variant.decimals !== onChain)
        this.logger.warn(
          `Catalog decimals ${variant.decimals} differ from mint ${variant.mint} (${onChain}); using the mint`,
        );
      return { ...variant, decimals: onChain };
    }
    if (isDecimals(variant.decimals)) return variant;
    throw new TokensBadRequestError(
      `Token precision for ${variant.symbol || variant.mint} is unavailable. Try again shortly.`,
    );
  }

  private async read(mint: string): Promise<number | undefined> {
    const cached = this.cache.get(mint);
    if (cached !== undefined) return cached;
    if (!this.rpc) return undefined;
    try {
      const result = await this.rpc.call<ParsedMintInfo>('getAccountInfo', [
        mint,
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]);
      const decimals = result.value?.data?.parsed?.info?.decimals;
      if (!isDecimals(decimals)) return undefined;
      this.cache.set(mint, decimals);
      return decimals;
    } catch (error) {
      this.logger.warn(
        `Could not read decimals for ${mint}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}

function isDecimals(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 18
  );
}
