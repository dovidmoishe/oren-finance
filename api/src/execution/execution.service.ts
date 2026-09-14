import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import bs58 from 'bs58';
import type {
  PostExecutionConfirmResponse,
  PostExecutionPrepareRequest,
} from '../../types/api';
import type {
  Basket,
  BasketCandidate,
  BasketLegProgress,
  PreparedTransaction,
  PreparedBasketPurchase,
  QuoteRequest,
  TradeIntent,
} from '../../types/execution';
import type { Quote } from '../../types/quote';
import type { TokenizedEquity } from '../../types/equity';
import {
  DEFAULT_SLIPPAGE_BPS,
  MIN_BASKET_LEG_USD,
  USDC_DECIMALS,
  USDC_MINT,
} from '../config/constants';
import {
  ExecutionNotFoundError,
  InvalidWalletAddressError,
} from '../common/errors/provider.errors';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TokensService } from '../tokens/tokens.service';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { BasketCache } from './basket-cache';
import { ExecutionRepository } from './execution.repository';
import { JupiterService } from './jupiter/jupiter.service';
import { QuoteCache } from './quote-cache';
import { VariantSelector } from './variant-selector';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly jupiter: JupiterService,
    private readonly selector: VariantSelector,
    private readonly cache: QuoteCache,
    private readonly baskets: BasketCache,
    private readonly repository: ExecutionRepository,
    private readonly portfolio: PortfolioService,
    private readonly tokens: TokensService,
    private readonly intelligence: IntelligenceService,
  ) {}

  async getQuote(body: TradeIntent | QuoteRequest): Promise<Quote> {
    if (!body?.side || (body.side !== 'buy' && body.side !== 'sell')) {
      throw new BadRequestException('side must be "buy" or "sell"');
    }

    if (isQuoteRequest(body)) {
      return this.quoteFromMints(body);
    }

    const intent = body as TradeIntent;
    if (!intent.ticker && !intent.assetId) {
      throw new BadRequestException('ticker or assetId is required');
    }
    if (intent.side === 'buy') {
      if (intent.amountUsd === undefined || intent.amountUsd <= 0) {
        throw new BadRequestException('amountUsd must be > 0 for buys');
      }
    } else if (intent.amount === undefined || intent.amount <= 0) {
      throw new BadRequestException('amount must be > 0 for sells');
    }

    const { quote } = await this.selector.selectAndQuote(intent);
    this.cache.set(quote);
    return quote;
  }

  async createBasket(input: {
    amountUsd: number;
    prompt: string;
    wallet?: string;
    candidates?: BasketCandidate[];
  }): Promise<Basket> {
    const amountUsd = Number(input.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new BadRequestException('amountUsd must be > 0');
    }
    if (!input.prompt?.trim()) {
      throw new BadRequestException('prompt is required');
    }

    const requestedCount = parseRequestedCount(input.prompt) ?? 3;
    const count = clampInt(requestedCount, 2, 5);
    if (amountUsd < count * MIN_BASKET_LEG_USD) {
      throw new BadRequestException(
        `amountUsd must be at least ${count * MIN_BASKET_LEG_USD} for ${count} basket legs`,
      );
    }

    const candidates =
      input.candidates && input.candidates.length > 0
        ? input.candidates
        : await this.intelligence.getOpportunities({
            limit: Math.max(count, 5),
          });
    const selected = normalizeCandidates(candidates).slice(0, count);

    if (selected.length === 0) {
      throw new BadRequestException('No basket candidates available');
    }
    if (
      selected.length < count &&
      amountUsd < selected.length * MIN_BASKET_LEG_USD
    ) {
      throw new BadRequestException(
        'Not enough amountUsd for available basket legs',
      );
    }

    const allocations = allocateBasket(amountUsd, selected).map(
      ({ candidate, amountUsd: legAmount, weightPercent }) => ({
        assetId: candidate.assetId,
        ticker: candidate.ticker,
        name: candidate.name,
        amountUsd: legAmount,
        weightPercent,
        opportunityScore: candidate.opportunityScore,
        rationale: buildBasketRationale(candidate),
      }),
    );

    const basket: Basket = {
      id: randomUUID(),
      totalAmountUsd: roundMoney(
        allocations.reduce((sum, allocation) => sum + allocation.amountUsd, 0),
      ),
      allocations,
      thesis: buildBasketThesis(input.prompt, allocations.length),
      riskLabel: riskLabelFromCandidates(selected),
      createdAt: new Date(),
    };

    this.baskets.set(basket);
    return basket;
  }

  createBasketFromAllocations(input: {
    totalAmountUsd: number;
    allocations: Basket['allocations'];
    thesis: string;
    riskLabel?: Basket['riskLabel'];
  }): Basket {
    const totalAmountUsd = Number(input.totalAmountUsd);
    if (!Number.isFinite(totalAmountUsd) || totalAmountUsd <= 0) {
      throw new BadRequestException('totalAmountUsd must be > 0');
    }
    if (!input.allocations.length) {
      throw new BadRequestException('allocations are required');
    }

    const basket: Basket = {
      id: randomUUID(),
      totalAmountUsd: roundMoney(totalAmountUsd),
      allocations: input.allocations,
      thesis: input.thesis,
      riskLabel: input.riskLabel,
      createdAt: new Date(),
    };

    this.baskets.set(basket);
    return basket;
  }

  async prepareBasketPurchase(input: {
    basketId: string;
    wallet: string;
  }): Promise<PreparedBasketPurchase> {
    if (!input.basketId?.trim()) {
      throw new BadRequestException('basketId is required');
    }
    const wallet = assertWallet(input.wallet);
    const basket = this.baskets.get(input.basketId.trim());
    if (basket.allocations.length === 0) {
      throw new BadRequestException('Basket has no allocations');
    }

    const transactions: PreparedTransaction[] = [];
    const legs: BasketLegProgress[] = [];

    for (const allocation of basket.allocations) {
      try {
        const quote = await this.getQuote({
          side: 'buy',
          assetId: allocation.assetId,
          ticker: allocation.ticker,
          amountUsd: allocation.amountUsd,
        });
        const preparedTransaction = await this.prepare({
          quoteId: quote.id,
          wallet,
        });
        transactions.push(preparedTransaction);
        legs.push({
          assetId: allocation.assetId,
          ticker: allocation.ticker,
          status: 'awaiting_signature' as const,
          quote,
          variant: quote.variant,
          preparedTransaction,
        });
      } catch (err) {
        legs.push({
          assetId: allocation.assetId,
          ticker: allocation.ticker,
          status: 'failed' as const,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (transactions.length === 0) {
      throw new BadRequestException('No basket legs could be prepared');
    }

    return {
      basketId: basket.id,
      wallet,
      transactions,
      progress: {
        basketId: basket.id,
        wallet,
        legs,
      },
    };
  }

  async prepare(
    input: PostExecutionPrepareRequest,
  ): Promise<PreparedTransaction> {
    const wallet = assertWallet(input.wallet);
    if (!input.quoteId?.trim()) {
      throw new BadRequestException('quoteId is required');
    }

    const entry = this.cache.get(input.quoteId);
    const quote = entry.quote;
    await this.jupiter.validateQuote(quote);

    const prepared = await this.jupiter.prepareSwap(quote, wallet);

    const row = await this.repository.insert({
      walletAddress: wallet,
      type: quote.side === 'buy' ? 'stock_purchase' : 'stock_sale',
      assetId: quote.assetId,
      ticker: quote.ticker,
      tokenMint: quote.variant.mint,
      inputAsset: quote.inputMint,
      outputAsset: quote.outputMint,
      amount: quote.side === 'buy' ? quote.outputAmount : quote.inputAmount,
      amountUsd: quote.amountUsd,
      provider: quote.provider,
      status: 'awaiting_signature',
    });

    this.cache.attachExecution(quote.id, row.id, wallet);
    return prepared;
  }

  async confirm(input: {
    quoteId: string;
    wallet: string;
    signature: string;
  }): Promise<PostExecutionConfirmResponse> {
    const wallet = assertWallet(input.wallet);
    if (!input.quoteId?.trim()) {
      throw new BadRequestException('quoteId is required');
    }
    if (!input.signature?.trim()) {
      throw new BadRequestException('signature is required');
    }

    let executionId =
      this.cache.getPendingExecution(input.quoteId)?.executionId ?? null;

    if (!executionId) {
      const latest = await this.repository.findLatestAwaitingSignature(wallet);
      executionId = latest?.id ?? null;
    }

    if (!executionId) {
      throw new ExecutionNotFoundError(
        `No pending execution for quote ${input.quoteId}`,
      );
    }

    await this.repository.updateStatus(executionId, {
      status: 'confirmed',
      transactionSignature: input.signature.trim(),
    });

    this.cache.delete(input.quoteId);

    let portfolioRefreshed = false;
    try {
      await this.portfolio.getPortfolio(wallet);
      portfolioRefreshed = true;
    } catch (err) {
      this.logger.warn(
        `Post-confirm portfolio refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      quoteId: input.quoteId,
      wallet,
      signature: input.signature.trim(),
      status: 'confirmed',
      portfolioRefreshed,
    };
  }

  private async quoteFromMints(req: QuoteRequest): Promise<Quote> {
    if (!req.inputMint || !req.outputMint) {
      throw new BadRequestException('inputMint and outputMint are required');
    }
    if (req.amount === undefined || req.amount <= 0) {
      throw new BadRequestException('amount must be > 0');
    }

    const stockMint = req.side === 'buy' ? req.outputMint : req.inputMint;
    let variant: TokenizedEquity = {
      mint: stockMint,
      symbol: req.ticker ?? 'TOKEN',
      name: req.ticker ?? 'TOKEN',
      decimals: USDC_DECIMALS,
      tradable: true,
    };
    let assetId = req.assetId ?? 'unknown';
    let ticker = req.ticker ?? 'UNKNOWN';

    try {
      const equity = await this.tokens.resolveMint(stockMint);
      if (equity) {
        assetId = equity.id;
        ticker = equity.ticker;
        variant = equity.variants.find((v) => v.mint === stockMint) ?? {
          ...variant,
          symbol: equity.ticker,
          name: equity.name,
        };
      }
    } catch {
      // keep placeholders
    }

    const inputDecimals =
      req.inputMint === USDC_MINT
        ? USDC_DECIMALS
        : (variant.decimals ?? USDC_DECIMALS);
    const outputDecimals =
      req.outputMint === USDC_MINT
        ? USDC_DECIMALS
        : (variant.decimals ?? USDC_DECIMALS);

    const amountUsd =
      req.inputMint === USDC_MINT
        ? req.amount
        : req.outputMint === USDC_MINT
          ? 0 // filled after quote from outAmount
          : req.amount;

    const quote = await this.jupiter.getQuoteWithContext({
      side: req.side,
      assetId,
      ticker,
      variant,
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      inputSymbol: req.inputMint === USDC_MINT ? 'USDC' : variant.symbol,
      outputSymbol: req.outputMint === USDC_MINT ? 'USDC' : variant.symbol,
      inputDecimals,
      outputDecimals,
      amountUi: req.amount,
      amountUsd,
      slippageBps: req.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    });

    if (req.side === 'sell' && quote.amountUsd === 0) {
      quote.amountUsd = quote.outputAmount;
    }

    this.cache.set(quote);
    return quote;
  }
}

function isQuoteRequest(
  body: TradeIntent | QuoteRequest,
): body is QuoteRequest {
  return (
    typeof (body as QuoteRequest).inputMint === 'string' &&
    typeof (body as QuoteRequest).outputMint === 'string'
  );
}

function assertWallet(wallet: string): string {
  if (!wallet?.trim()) {
    throw new InvalidWalletAddressError('wallet is required');
  }
  try {
    const bytes = bs58.decode(wallet.trim());
    if (bytes.length !== 32) {
      throw new InvalidWalletAddressError();
    }
    return wallet.trim();
  } catch (err) {
    if (err instanceof InvalidWalletAddressError) throw err;
    throw new InvalidWalletAddressError();
  }
}

function parseRequestedCount(prompt: string): number | undefined {
  const lower = prompt.toLowerCase();
  const words = new Map([
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
  ]);
  for (const [word, count] of words) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return count;
  }
  const match = lower.match(/\b([2-5])\b/);
  return match ? Number(match[1]) : undefined;
}

function normalizeCandidates(candidates: BasketCandidate[]): BasketCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.assetId && candidate.ticker)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .filter((candidate) => {
      const key = candidate.assetId.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function allocateBasket(
  amountUsd: number,
  candidates: BasketCandidate[],
): { candidate: BasketCandidate; amountUsd: number; weightPercent: number }[] {
  const scores = candidates.map((candidate) =>
    Math.max(candidate.opportunityScore || 0, 1),
  );
  const totalScore = scores.reduce((sum, score) => sum + score, 0);
  let remainingCents = Math.round(amountUsd * 100);

  return candidates.map((candidate, index) => {
    const isLast = index === candidates.length - 1;
    const remainingLegs = candidates.length - index - 1;
    const maxForCurrent =
      remainingCents - remainingLegs * MIN_BASKET_LEG_USD * 100;
    const weightedCents = Math.round(
      (amountUsd * 100 * scores[index]) / totalScore,
    );
    const cents = isLast
      ? remainingCents
      : Math.min(
          maxForCurrent,
          Math.max(MIN_BASKET_LEG_USD * 100, weightedCents),
        );
    remainingCents -= cents;
    const legAmount = cents / 100;
    return {
      candidate,
      amountUsd: legAmount,
      weightPercent: roundPercent((legAmount / amountUsd) * 100),
    };
  });
}

function buildBasketRationale(candidate: BasketCandidate): string {
  const score = Math.round(candidate.opportunityScore);
  return `${candidate.ticker} is included from Oren opportunities with an opportunity score of ${score}.`;
}

function buildBasketThesis(prompt: string, legCount: number): string {
  return `A ${legCount}-stock basket generated from deterministic Oren opportunity data for: ${prompt.trim()}`;
}

function riskLabelFromCandidates(
  candidates: BasketCandidate[],
): Basket['riskLabel'] {
  const volatilities = candidates
    .map((candidate) => candidate.signals?.volatility30d)
    .filter((value): value is number => Number.isFinite(value));
  if (volatilities.length === 0) return 'moderate';
  const avg =
    volatilities.reduce((sum, value) => sum + value, 0) / volatilities.length;
  if (avg < 2) return 'low';
  if (avg < 5) return 'moderate';
  if (avg < 8) return 'elevated';
  return 'high';
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPercent(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}
