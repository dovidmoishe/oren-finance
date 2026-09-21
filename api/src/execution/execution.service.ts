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
  ExecutionFeature,
} from '../../types/execution';
import type {
  LimitOrderIntent,
  LimitOrderProposal,
  LimitOrderRecord,
  PreparedLimitCancel,
  PreparedLimitOrder,
} from '../../types/limit-order';
import type { Quote } from '../../types/quote';
import type { TokenizedEquity } from '../../types/equity';
import {
  DEFAULT_SLIPPAGE_BPS,
  MIN_BASKET_LEG_USD,
  PENDING_EXECUTION_TTL_MS,
  USDC_DECIMALS,
  USDC_MINT,
} from '../config/constants';
import {
  ExecutionNotFoundError,
  InvalidWalletAddressError,
  JupiterBadRequestError,
  TokensNotFoundError,
} from '../common/errors/provider.errors';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TokensService } from '../tokens/tokens.service';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { BasketCache } from './basket-cache';
import { ExecutionRepository } from './execution.repository';
import { JupiterService } from './jupiter/jupiter.service';
import { JupiterTriggerClient } from './jupiter/jupiter-trigger.client';
import {
  computeLimitOrderAmounts,
  defaultLimitExpiredAt,
} from './jupiter/limit-order-math';
import { LimitOrderCache } from './limit-order-cache';
import { LimitOrderRepository } from './limit-order.repository';
import { QuoteCache } from './quote-cache';
import { VariantSelector } from './variant-selector';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly jupiter: JupiterService,
    private readonly trigger: JupiterTriggerClient,
    private readonly selector: VariantSelector,
    private readonly cache: QuoteCache,
    private readonly baskets: BasketCache,
    private readonly limitOrders: LimitOrderCache,
    private readonly limitOrderRepository: LimitOrderRepository,
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
      featureSource: 'basket',
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
    featureSource?: Extract<ExecutionFeature, 'basket' | 'copy_trade'>;
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
      featureSource: input.featureSource ?? 'basket',
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
        const preparedTransaction = await this.prepare(
          { quoteId: quote.id, wallet },
          basket.featureSource ?? 'basket',
        );
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
    featureSource: ExecutionFeature = 'direct',
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
      featureSource,
      status: 'awaiting_signature',
    });

    this.cache.attachExecution(quote.id, row.id, wallet);
    return { ...prepared, executionId: row.id };
  }

  async confirm(input: {
    executionId?: string;
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

    const cached = this.cache.getPendingExecution(input.quoteId);
    const executionId = input.executionId?.trim() || cached?.executionId;

    if (!executionId) {
      throw new ExecutionNotFoundError(
        `No pending execution for quote ${input.quoteId}`,
      );
    }

    const submitted = await this.repository.submitAndEnqueue({
      executionId,
      walletAddress: wallet,
      transactionSignature: input.signature.trim(),
    });
    if (!submitted) {
      throw new ExecutionNotFoundError(`Execution not found: ${executionId}`);
    }

    this.cache.delete(input.quoteId);

    return {
      executionId,
      quoteId: input.quoteId,
      wallet,
      signature: input.signature.trim(),
      status: 'submitted',
      trackingStatus: 'pending',
    };
  }

  async getExecutionStatus(executionId: string) {
    const row = await this.repository.findById(executionId);
    if (!row) throw new ExecutionNotFoundError(`Execution not found: ${executionId}`);
    return {
      executionId: row.id,
      signature: row.transactionSignature ?? undefined,
      status: row.status,
      submittedAt: row.submittedAt ?? undefined,
    };
  }

  async proposeLimitOrder(
    intent: LimitOrderIntent,
  ): Promise<LimitOrderProposal> {
    if (!intent?.side || (intent.side !== 'buy' && intent.side !== 'sell')) {
      throw new BadRequestException('side must be "buy" or "sell"');
    }
    if (!intent.ticker && !intent.assetId) {
      throw new BadRequestException('ticker or assetId is required');
    }
    if (
      !Number.isFinite(intent.limitPriceUsd) ||
      intent.limitPriceUsd <= 0
    ) {
      throw new BadRequestException('limitPriceUsd must be > 0');
    }

    const equity = intent.assetId
      ? await this.tokens.getStock(intent.assetId)
      : await this.resolveEquityByTicker(intent.ticker);
    const candidates = this.selector.pickCandidates(
      equity,
      intent.preferredMint,
    );
    if (candidates.length === 0) {
      throw new TokensNotFoundError(
        `No tradable variants for ${equity.ticker}`,
      );
    }
    const variant = candidates[0];
    const stockDecimals = variant.decimals ?? USDC_DECIMALS;

    let amount: number;
    if (intent.side === 'buy') {
      if (intent.amountUsd === undefined || intent.amountUsd <= 0) {
        throw new BadRequestException('amountUsd must be > 0 for buys');
      }
      amount = intent.amountUsd;
    } else {
      if (intent.amount === undefined || intent.amount <= 0) {
        throw new BadRequestException('amount must be > 0 for sells');
      }
      amount = intent.amount;
    }

    let rates;
    try {
      rates = computeLimitOrderAmounts({
        side: intent.side,
        amount,
        limitPriceUsd: intent.limitPriceUsd,
        stockDecimals,
        marketPriceUsd: equity.price,
      });
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid limit order amounts',
      );
    }

    const expiredAt = intent.expiredAt ?? defaultLimitExpiredAt();
    const proposal: LimitOrderProposal = {
      id: randomUUID(),
      side: intent.side,
      assetId: equity.id,
      ticker: equity.ticker,
      variant,
      inputMint: intent.side === 'buy' ? USDC_MINT : variant.mint,
      outputMint: intent.side === 'buy' ? variant.mint : USDC_MINT,
      inputSymbol: intent.side === 'buy' ? 'USDC' : variant.symbol,
      outputSymbol: intent.side === 'buy' ? variant.symbol : 'USDC',
      makingAmount: rates.makingAmount,
      takingAmount: rates.takingAmount,
      makingAmountRaw: rates.makingAmountRaw,
      takingAmountRaw: rates.takingAmountRaw,
      limitPriceUsd: intent.limitPriceUsd,
      amountUsd: rates.amountUsd,
      marketPriceUsd: equity.price,
      wouldFillImmediately: rates.wouldFillImmediately,
      basis: intent.basis,
      expiredAt,
      slippageBps: intent.slippageBps ?? 0,
      provider: 'jupiter-trigger',
      createdAt: new Date(),
    };

    this.limitOrders.setProposal(proposal);
    return proposal;
  }

  async prepareLimitOrder(input: {
    proposalId: string;
    wallet: string;
  }): Promise<PreparedLimitOrder> {
    const wallet = assertWallet(input.wallet);
    if (!input.proposalId?.trim()) {
      throw new BadRequestException('proposalId is required');
    }

    const proposal = this.limitOrders.getProposal(input.proposalId);
    const created = await this.trigger.createOrder({
      inputMint: proposal.inputMint,
      outputMint: proposal.outputMint,
      maker: wallet,
      payer: wallet,
      params: {
        makingAmount: proposal.makingAmountRaw,
        takingAmount: proposal.takingAmountRaw,
        expiredAt: String(proposal.expiredAt),
        ...(proposal.slippageBps > 0
          ? { slippageBps: String(proposal.slippageBps) }
          : {}),
      },
      computeUnitPrice: 'auto',
    });

    if (!created.requestId || !created.transaction) {
      throw new JupiterBadRequestError(
        created.error ??
          created.cause ??
          'Jupiter Trigger createOrder returned no transaction',
      );
    }

    const row = await this.repository.insert({
      walletAddress: wallet,
      type: proposal.side === 'buy' ? 'limit_buy' : 'limit_sell',
      assetId: proposal.assetId,
      ticker: proposal.ticker,
      tokenMint: proposal.variant.mint,
      inputAsset: proposal.inputMint,
      outputAsset: proposal.outputMint,
      amount:
        proposal.side === 'buy' ? proposal.takingAmount : proposal.makingAmount,
      amountUsd: proposal.amountUsd,
      provider: proposal.provider,
      featureSource: 'limit_order',
      status: 'awaiting_signature',
    });

    const prepared: PreparedLimitOrder = {
      proposalId: proposal.id,
      wallet,
      transaction: created.transaction,
      requestId: created.requestId,
      orderKey: created.order,
      provider: proposal.provider,
      expiresAt: new Date(Date.now() + PENDING_EXECUTION_TTL_MS),
      executionId: row.id,
    };
    this.limitOrders.attachPrepared(prepared);
    return prepared;
  }

  async confirmLimitOrder(input: {
    proposalId: string;
    wallet: string;
    signature: string;
    orderKey?: string;
  }): Promise<{
    proposalId: string;
    wallet: string;
    signature: string;
    orderKey: string;
    status: 'confirmed';
    portfolioRefreshed: boolean;
  }> {
    const wallet = assertWallet(input.wallet);
    if (!input.proposalId?.trim()) {
      throw new BadRequestException('proposalId is required');
    }
    if (!input.signature?.trim()) {
      throw new BadRequestException('signature is required');
    }

    const proposal = this.limitOrders.getProposal(input.proposalId);
    const prepared = this.limitOrders.getPrepared(input.proposalId);
    const orderKey = input.orderKey?.trim() || prepared.orderKey;
    if (!orderKey) {
      throw new BadRequestException(
        'orderKey is required to persist the limit order',
      );
    }

    await this.repository.updateStatus(prepared.executionId, {
      status: 'confirmed',
      transactionSignature: input.signature.trim(),
    });

    await this.limitOrderRepository.upsert({
      walletAddress: wallet,
      orderKey,
      side: proposal.side,
      assetId: proposal.assetId,
      ticker: proposal.ticker,
      inputMint: proposal.inputMint,
      outputMint: proposal.outputMint,
      makingAmount: proposal.makingAmount,
      takingAmount: proposal.takingAmount,
      limitPriceUsd: proposal.limitPriceUsd,
      amountUsd: proposal.amountUsd,
      status: 'open',
      basis: proposal.basis,
      openSignature: input.signature.trim(),
      expiredAt: new Date(proposal.expiredAt * 1000),
    });

    this.limitOrders.deleteProposal(input.proposalId);

    let portfolioRefreshed = false;
    try {
      await this.portfolio.getPortfolio(wallet);
      portfolioRefreshed = true;
    } catch (err) {
      this.logger.warn(
        `Post-limit-confirm portfolio refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      proposalId: input.proposalId,
      wallet,
      signature: input.signature.trim(),
      orderKey,
      status: 'confirmed',
      portfolioRefreshed,
    };
  }

  async listLimitOrders(
    wallet: string,
    options?: { includeHistory?: boolean },
  ): Promise<LimitOrderRecord[]> {
    const address = assertWallet(wallet);
    const indexed = await this.limitOrderRepository.listByWallet(address);
    const byKey = new Map(
      indexed.map((row) => [row.orderKey, this.limitOrderRepository.toRecord(row)]),
    );

    try {
      const active = await this.trigger.getTriggerOrders({
        user: address,
        orderStatus: 'active',
      });
      for (const order of active.orders ?? []) {
        const existing = byKey.get(order.orderKey);
        const side: 'buy' | 'sell' =
          existing?.side ??
          (order.inputMint === USDC_MINT ? 'buy' : 'sell');
        byKey.set(order.orderKey, {
          id: existing?.id ?? order.orderKey,
          walletAddress: address,
          orderKey: order.orderKey,
          side,
          assetId: existing?.assetId,
          ticker: existing?.ticker,
          inputMint: order.inputMint,
          outputMint: order.outputMint,
          makingAmount: Number(order.makingAmount),
          takingAmount: Number(order.takingAmount),
          limitPriceUsd:
            existing?.limitPriceUsd ??
            inferLimitPriceUsd(side, Number(order.makingAmount), Number(order.takingAmount)),
          amountUsd: existing?.amountUsd,
          status: 'open',
          basis: existing?.basis,
          openSignature: order.openTx || existing?.openSignature,
          closeSignature: order.closeTx || existing?.closeSignature,
          expiredAt: order.expiredAt
            ? new Date(Number(order.expiredAt) * 1000)
            : existing?.expiredAt,
          createdAt: existing?.createdAt ?? new Date(order.createdAt),
          updatedAt: new Date(order.updatedAt),
        });
      }

      if (options?.includeHistory) {
        const history = await this.trigger.getTriggerOrders({
          user: address,
          orderStatus: 'history',
        });
        for (const order of history.orders ?? []) {
          const existing = byKey.get(order.orderKey);
          const side: 'buy' | 'sell' =
            existing?.side ??
            (order.inputMint === USDC_MINT ? 'buy' : 'sell');
          const status = mapJupiterOrderStatus(order.status);
          byKey.set(order.orderKey, {
            id: existing?.id ?? order.orderKey,
            walletAddress: address,
            orderKey: order.orderKey,
            side,
            assetId: existing?.assetId,
            ticker: existing?.ticker,
            inputMint: order.inputMint,
            outputMint: order.outputMint,
            makingAmount: Number(order.makingAmount),
            takingAmount: Number(order.takingAmount),
            limitPriceUsd:
              existing?.limitPriceUsd ??
              inferLimitPriceUsd(
                side,
                Number(order.makingAmount),
                Number(order.takingAmount),
              ),
            amountUsd: existing?.amountUsd,
            status,
            basis: existing?.basis,
            openSignature: order.openTx || existing?.openSignature,
            closeSignature: order.closeTx || existing?.closeSignature,
            expiredAt: order.expiredAt
              ? new Date(Number(order.expiredAt) * 1000)
              : existing?.expiredAt,
            createdAt: existing?.createdAt ?? new Date(order.createdAt),
            updatedAt: new Date(order.updatedAt),
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `Jupiter Trigger list failed, falling back to indexed rows: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return [...byKey.values()].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  }

  async prepareCancelLimitOrder(input: {
    orderKey: string;
    wallet: string;
  }): Promise<PreparedLimitCancel> {
    const wallet = assertWallet(input.wallet);
    if (!input.orderKey?.trim()) {
      throw new BadRequestException('orderKey is required');
    }

    const cancelled = await this.trigger.cancelOrder({
      maker: wallet,
      order: input.orderKey.trim(),
      computeUnitPrice: 'auto',
    });
    if (!cancelled.requestId || !cancelled.transaction) {
      throw new JupiterBadRequestError(
        cancelled.error ??
          cancelled.cause ??
          'Jupiter Trigger cancelOrder returned no transaction',
      );
    }

    const indexed = await this.limitOrderRepository.findByOrderKey(
      input.orderKey.trim(),
    );
    const row = await this.repository.insert({
      walletAddress: wallet,
      type: 'limit_cancel',
      assetId: indexed?.assetId ?? undefined,
      ticker: indexed?.ticker ?? undefined,
      tokenMint: indexed
        ? indexed.side === 'buy'
          ? indexed.outputMint
          : indexed.inputMint
        : undefined,
      provider: 'jupiter-trigger',
      status: 'awaiting_signature',
    });

    const prepared: PreparedLimitCancel = {
      orderKey: input.orderKey.trim(),
      wallet,
      transaction: cancelled.transaction,
      requestId: cancelled.requestId,
      provider: 'jupiter-trigger',
      expiresAt: new Date(Date.now() + PENDING_EXECUTION_TTL_MS),
      executionId: row.id,
    };
    this.limitOrders.setCancel(prepared);
    return prepared;
  }

  async confirmCancelLimitOrder(input: {
    orderKey: string;
    wallet: string;
    signature: string;
  }): Promise<{
    orderKey: string;
    wallet: string;
    signature: string;
    status: 'cancelled';
  }> {
    const wallet = assertWallet(input.wallet);
    if (!input.orderKey?.trim()) {
      throw new BadRequestException('orderKey is required');
    }
    if (!input.signature?.trim()) {
      throw new BadRequestException('signature is required');
    }

    const prepared = this.limitOrders.getCancel(input.orderKey.trim());
    await this.repository.updateStatus(prepared.executionId, {
      status: 'confirmed',
      transactionSignature: input.signature.trim(),
    });
    await this.limitOrderRepository.updateStatus(input.orderKey.trim(), {
      status: 'cancelled',
      closeSignature: input.signature.trim(),
    });
    this.limitOrders.deleteCancel(input.orderKey.trim());

    return {
      orderKey: input.orderKey.trim(),
      wallet,
      signature: input.signature.trim(),
      status: 'cancelled',
    };
  }

  private async resolveEquityByTicker(ticker: string) {
    const q = ticker?.trim();
    if (!q) {
      throw new TokensNotFoundError('ticker or assetId is required');
    }
    const results = await this.tokens.searchStocks(q);
    const exact = results.find(
      (equity) => equity.ticker.toUpperCase() === q.toUpperCase(),
    );
    if (exact) return exact;
    if (results[0]) return results[0];
    throw new TokensNotFoundError(`Stock not found: ${q}`);
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

function inferLimitPriceUsd(
  side: 'buy' | 'sell',
  makingAmount: number,
  takingAmount: number,
): number {
  if (!makingAmount || !takingAmount) return 0;
  return side === 'buy'
    ? makingAmount / takingAmount
    : takingAmount / makingAmount;
}

function mapJupiterOrderStatus(
  status: string,
): import('../../types/limit-order').LimitOrderStatus {
  const normalized = status.toLowerCase();
  if (normalized.includes('complete') || normalized.includes('filled')) {
    return 'filled';
  }
  if (normalized.includes('cancel')) return 'cancelled';
  if (normalized.includes('expir')) return 'expired';
  if (normalized.includes('fail')) return 'failed';
  if (normalized.includes('open') || normalized.includes('active')) {
    return 'open';
  }
  return 'open';
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
