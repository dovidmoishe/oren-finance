import { Injectable } from '@nestjs/common';
import type { Quote } from '../../types/quote';
import {
  PENDING_EXECUTION_TTL_MS,
  QUOTE_TTL_MS,
} from '../config/constants';
import { QuoteExpiredError } from '../common/errors/provider.errors';

export interface CachedQuoteEntry {
  quote: Quote;
  /** Set after prepare. */
  executionId?: string;
  storedAt: number;
}

@Injectable()
export class QuoteCache {
  private readonly quotes = new Map<string, CachedQuoteEntry>();
  private readonly pendingByQuoteId = new Map<
    string,
    { executionId: string; wallet: string; expiresAt: number }
  >();

  set(quote: Quote): void {
    this.quotes.set(quote.id, {
      quote,
      storedAt: Date.now(),
    });
  }

  get(quoteId: string): CachedQuoteEntry {
    const entry = this.quotes.get(quoteId);
    if (!entry) {
      throw new QuoteExpiredError(
        `Quote not found: ${quoteId}. Refresh the quote or basket and try again.`,
      );
    }
    if (entry.quote.expiresAt.getTime() <= Date.now()) {
      this.quotes.delete(quoteId);
      throw new QuoteExpiredError(
        `Quote expired: ${quoteId}. Refresh the quote or basket and try again.`,
      );
    }
    if (Date.now() - entry.storedAt > QUOTE_TTL_MS + 5_000) {
      this.quotes.delete(quoteId);
      throw new QuoteExpiredError(
        `Quote expired: ${quoteId}. Refresh the quote or basket and try again.`,
      );
    }
    return entry;
  }

  /** Soft get — returns null instead of throwing. */
  peek(quoteId: string): CachedQuoteEntry | null {
    try {
      return this.get(quoteId);
    } catch {
      return null;
    }
  }

  attachExecution(quoteId: string, executionId: string, wallet: string): void {
    const entry = this.quotes.get(quoteId);
    if (entry) {
      entry.executionId = executionId;
    }
    this.pendingByQuoteId.set(quoteId, {
      executionId,
      wallet,
      expiresAt: Date.now() + PENDING_EXECUTION_TTL_MS,
    });
  }

  getPendingExecution(
    quoteId: string,
  ): { executionId: string; wallet: string } | null {
    const pending = this.pendingByQuoteId.get(quoteId);
    if (!pending) return null;
    if (pending.expiresAt <= Date.now()) {
      this.pendingByQuoteId.delete(quoteId);
      return null;
    }
    return { executionId: pending.executionId, wallet: pending.wallet };
  }

  delete(quoteId: string): void {
    this.quotes.delete(quoteId);
  }
}
