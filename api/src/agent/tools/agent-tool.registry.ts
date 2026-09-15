import { BadRequestException, Injectable } from '@nestjs/common';
import type { AgentArtifact } from '../../../types/agent';
import type { TradeIntent } from '../../../types/execution';
import type { ChartRange } from '../../../types/market';
import { ExecutionService } from '../../execution/execution.service';
import { IntelligenceService } from '../../intelligence/intelligence.service';
import { MarketService } from '../../market/market.service';
import { NewsService } from '../../news/news.service';
import { PortfolioCalendarService } from '../../portfolio/portfolio-calendar.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { SocialService } from '../../social/social.service';
import { VaultService } from '../../vault/vault.service';

export interface AgentToolResult {
  output: unknown;
  artifact?: AgentArtifact;
}

export type ToolDefinition = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};

@Injectable()
export class AgentToolRegistry {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly market: MarketService,
    private readonly news: NewsService,
    private readonly intelligence: IntelligenceService,
    private readonly execution: ExecutionService,
    private readonly vault: VaultService,
    private readonly social: SocialService,
    private readonly calendar: PortfolioCalendarService,
  ) {}

  getSchemas(): ToolDefinition[] {
    return TOOL_SCHEMAS;
  }

  async dispatch(name: string, args: unknown): Promise<AgentToolResult> {
    const input = asRecord(args);

    switch (name) {
      case 'getPortfolio':
        {
          const portfolio = await this.portfolio.getPortfolio(
            required(input, 'wallet'),
          );
          return {
            output: portfolio,
            artifact: { type: 'portfolio', data: portfolio },
          };
        }

      case 'getPortfolioActivity':
        return {
          output: await this.portfolio.getActivity(required(input, 'wallet')),
        };

      case 'getTradingCalendar': {
        const calendar = await this.calendar.getCalendar(required(input, 'wallet'), {
          month: optionalString(input, 'month'),
          start: optionalString(input, 'start'),
          end: optionalString(input, 'end'),
          timeZone: optionalString(input, 'timeZone'),
        });
        return {
          output: calendar,
          artifact: { type: 'trading_calendar', data: calendar },
        };
      }

      case 'getTradingCalendarDay': {
        const day = await this.calendar.getDay(
          required(input, 'wallet'),
          required(input, 'date'),
          { timeZone: optionalString(input, 'timeZone') },
        );
        return {
          output: day,
          artifact: { type: 'trading_calendar_day', data: day },
        };
      }

      case 'getStock': {
        const stock = await this.getStockByInput(
          required(input, 'assetIdOrTicker'),
        );
        return { output: stock, artifact: { type: 'stock', data: stock } };
      }

      case 'getStockChart': {
        const stock = await this.getStockByInput(
          required(input, 'assetIdOrTicker'),
        );
        const range = optional(input, 'range') as ChartRange | undefined;
        return { output: await this.market.getChart(stock.id, range ?? '1M') };
      }

      case 'getStockNews': {
        const stock = await this.getStockByInput(
          required(input, 'assetIdOrTicker'),
        );
        const feed = await this.news.getEquityNews(stock.id);
        return { output: feed.items };
      }

      case 'analyzeStock': {
        const stock = await this.getStockByInput(
          required(input, 'assetIdOrTicker'),
        );
        const analysis = await this.intelligence.getAnalysis(stock.id);
        return {
          output: analysis,
          artifact: { type: 'analysis', data: analysis },
        };
      }

      case 'searchStocks':
        return {
          output: await this.market.searchStocks(required(input, 'query')),
        };

      case 'findOpportunities': {
        const opportunities = await this.intelligence.getOpportunities({
          minScore: optionalNumber(input, 'minScore'),
          limit: optionalNumber(input, 'limit'),
        });
        return {
          output: opportunities,
          artifact: { type: 'opportunities', data: opportunities },
        };
      }

      case 'getSignals': {
        const stock = await this.getStockByInput(
          required(input, 'assetIdOrTicker'),
        );
        return { output: await this.intelligence.getSignals(stock.id) };
      }

      case 'getSwapQuote': {
        const intent: TradeIntent = {
          side: required(input, 'side') as TradeIntent['side'],
          ticker: optionalString(input, 'ticker') ?? '',
          assetId: optionalString(input, 'assetId'),
          amountUsd: optionalNumber(input, 'amountUsd'),
          amount: optionalNumber(input, 'amount'),
          preferredMint: optionalString(input, 'preferredMint'),
          slippageBps: optionalNumber(input, 'slippageBps'),
        };
        const quote = await this.execution.getQuote(intent);
        return { output: quote, artifact: { type: 'quote', data: quote } };
      }

      case 'proposeLimitOrder': {
        let limitPriceUsd = optionalNumber(input, 'limitPriceUsd');
        let basis: import('../../../types/analysis').LimitZoneBasis | undefined;
        const side = required(input, 'side') as 'buy' | 'sell';
        const ticker = optionalString(input, 'ticker') ?? '';
        const assetId = optionalString(input, 'assetId');

        if (limitPriceUsd === undefined) {
          const stockKey = assetId || ticker;
          if (!stockKey) {
            throw new BadRequestException('ticker or assetId is required');
          }
          const stock = await this.getStockByInput(stockKey);
          const analysis = await this.intelligence.getAnalysis(stock.id);
          const zone = analysis.technicalBrief?.limitZones?.find(
            (item) => item.side === side,
          );
          if (!zone) {
            throw new BadRequestException(
              `No deterministic ${side} limit zone available for ${stock.ticker}. Provide limitPriceUsd explicitly.`,
            );
          }
          limitPriceUsd = zone.preferredUsd;
          basis = zone.basis;
        }

        const proposal = await this.execution.proposeLimitOrder({
          side,
          ticker,
          assetId,
          amountUsd: optionalNumber(input, 'amountUsd'),
          amount: optionalNumber(input, 'amount'),
          limitPriceUsd,
          preferredMint: optionalString(input, 'preferredMint'),
          expiredAt: optionalNumber(input, 'expiredAt'),
          slippageBps: optionalNumber(input, 'slippageBps'),
          wallet: optionalString(input, 'wallet'),
          basis,
        });
        return {
          output: proposal,
          artifact: { type: 'limit_order', data: proposal },
        };
      }

      case 'getLimitOrders': {
        const orders = await this.execution.listLimitOrders(
          required(input, 'wallet'),
          {
            includeHistory: optional(input, 'includeHistory') === true,
          },
        );
        return {
          output: orders,
          artifact: { type: 'limit_orders', data: orders },
        };
      }

      case 'prepareSwap': {
        const prepared = await this.execution.prepare({
          quoteId: required(input, 'quoteId'),
          wallet: required(input, 'wallet'),
        });
        return {
          output: prepared,
          artifact: { type: 'prepared_swap', data: prepared },
        };
      }

      case 'getVaults':
        {
          const vaults = await this.vault.listVaults(
            required(input, 'wallet'),
          );
          return {
            output: vaults,
            artifact: { type: 'vaults', data: vaults },
          };
        }

      case 'prepareLock': {
        const prepared = await this.vault.prepareLock({
          action: 'lock',
          wallet: required(input, 'wallet'),
          asset: required(input, 'asset'),
          amount: requiredNumber(input, 'amount'),
          unlockAt: new Date(required(input, 'unlockAt')),
        });
        return {
          output: prepared,
          artifact: { type: 'prepared_lock', data: prepared },
        };
      }

      case 'prepareUnlock': {
        const prepared = await this.vault.prepareUnlock({
          action: 'unlock',
          wallet: required(input, 'wallet'),
          lockAddress: required(input, 'lockAddress'),
        });
        return {
          output: prepared,
          artifact: { type: 'prepared_unlock', data: prepared },
        };
      }

      case 'createBasket': {
        const basket = await this.execution.createBasket({
          amountUsd: requiredNumber(input, 'amountUsd'),
          prompt: required(input, 'prompt'),
          wallet: optionalString(input, 'wallet'),
          candidates: Array.isArray(input.candidates)
            ? (input.candidates as never)
            : undefined,
        });
        return { output: basket, artifact: { type: 'basket', data: basket } };
      }

      case 'getLeaderboard': {
        const leaderboard = await this.social.getLeaderboard({
          timeframe: optionalString(input, 'timeframe') as never,
          limit: optionalNumber(input, 'limit'),
        });
        return { output: leaderboard };
      }

      case 'getTraderProfile': {
        const trader = await this.social.getTraderDetail(
          required(input, 'slug'),
          optionalString(input, 'timeframe') as never,
        );
        return { output: trader };
      }

      case 'prepareCopyPortfolio': {
        const proposal = await this.social.prepareCopyPortfolio({
          sourceSlug: required(input, 'sourceSlug'),
          wallet: required(input, 'wallet'),
          amountUsd: requiredNumber(input, 'amountUsd'),
        });
        return {
          output: proposal,
          artifact: { type: 'copy_portfolio_proposal', data: proposal },
        };
      }

      case 'prepareBasketPurchase': {
        const prepared = await this.execution.prepareBasketPurchase({
          basketId: required(input, 'basketId'),
          wallet: required(input, 'wallet'),
        });
        return {
          output: prepared,
          artifact: { type: 'prepared_basket', data: prepared },
        };
      }

      default:
        throw new BadRequestException(`Unknown agent tool: ${name}`);
    }
  }

  private async getStockByInput(assetIdOrTicker: string) {
    const value = assetIdOrTicker.trim();
    try {
      return await this.market.getStock(value);
    } catch {
      const results = await this.market.searchStocks(value);
      const match =
        results.find(
          (item) => item.ticker.toLowerCase() === value.toLowerCase(),
        ) ?? results[0];
      if (!match) {
        throw new BadRequestException(`Unknown stock: ${assetIdOrTicker}`);
      }
      return this.market.getStock(match.id);
    }
  }
}

const stringSchema = { type: 'string' };
const numberSchema = { type: 'number' };
const nullableStringSchema = { type: ['string', 'null'] };
const nullableNumberSchema = { type: ['number', 'null'] };
const nullableBooleanSchema = { type: ['boolean', 'null'] };

const TOOL_SCHEMAS: ToolDefinition[] = [
  tool(
    'getPortfolio',
    'Get the latest portfolio for the connected wallet. Use the attached snapshot for conversational advice; call this before trade sizing or quotes when balances may have changed.',
    {
      wallet: stringSchema,
    },
  ),
  tool('getPortfolioActivity', 'Get Oren and wallet activity for a wallet.', {
    wallet: stringSchema,
  }),
  tool(
    'getTradingCalendar',
    'Get observed daily portfolio P&L, event markers, and calendar summaries for a wallet.',
    {
      wallet: stringSchema,
      month: nullableStringSchema,
      start: nullableStringSchema,
      end: nullableStringSchema,
      timeZone: nullableStringSchema,
    },
  ),
  tool(
    'getTradingCalendarDay',
    'Get a day drilldown with observed P&L, contributors, trades, vault events, agent events, and wallet activity.',
    {
      wallet: stringSchema,
      date: stringSchema,
      timeZone: nullableStringSchema,
    },
  ),
  tool('getStock', 'Get canonical stock detail by asset id or ticker.', {
    assetIdOrTicker: stringSchema,
  }),
  tool(
    'getStockChart',
    'Get normalized stock chart candles.',
    {
      assetIdOrTicker: stringSchema,
      range: {
        type: ['string', 'null'],
        enum: ['1D', '1W', '1M', '3M', '1Y', 'ALL', null],
      },
    },
  ),
  tool('getStockNews', 'Get recent news for a canonical stock.', {
    assetIdOrTicker: stringSchema,
  }),
  tool(
    'analyzeStock',
    'Get deterministic Oren Score plus a full technical-analysis brief (regime, setup, support/resistance, multi-timeframe indicators, summary, and news overlay) for a stock.',
    {
      assetIdOrTicker: stringSchema,
    },
  ),
  tool('searchStocks', 'Search canonical stocks by ticker or company name.', {
    query: stringSchema,
  }),
  tool(
    'findOpportunities',
    'Find ranked Oren opportunities.',
    {
      minScore: nullableNumberSchema,
      limit: nullableNumberSchema,
    },
  ),
  tool('getSignals', 'Get deterministic quantitative signals for a stock.', {
    assetIdOrTicker: stringSchema,
  }),
  tool(
    'getSwapQuote',
    'Get a Jupiter quote for buying or selling a stock.',
    {
      side: { type: 'string', enum: ['buy', 'sell'] },
      ticker: nullableStringSchema,
      assetId: nullableStringSchema,
      amountUsd: nullableNumberSchema,
      amount: nullableNumberSchema,
      preferredMint: nullableStringSchema,
      slippageBps: nullableNumberSchema,
    },
  ),
  tool(
    'proposeLimitOrder',
    'Propose a Jupiter Trigger V1 limit order at a USD price. If limitPriceUsd is omitted, uses the deterministic TA limit zone from analyzeStock. Returns a reviewable proposal — never prepares or signs.',
    {
      side: { type: 'string', enum: ['buy', 'sell'] },
      ticker: nullableStringSchema,
      assetId: nullableStringSchema,
      amountUsd: nullableNumberSchema,
      amount: nullableNumberSchema,
      limitPriceUsd: nullableNumberSchema,
      preferredMint: nullableStringSchema,
      expiredAt: nullableNumberSchema,
      slippageBps: nullableNumberSchema,
      wallet: nullableStringSchema,
    },
  ),
  tool(
    'getLimitOrders',
    'List the wallet open (and optionally historical) Jupiter Trigger limit orders.',
    {
      wallet: stringSchema,
      includeHistory: nullableBooleanSchema,
    },
  ),
  tool(
    'createBasket',
    'Planned basket creation tool.',
    {
      amountUsd: numberSchema,
      prompt: stringSchema,
      wallet: nullableStringSchema,
      candidates: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            assetId: stringSchema,
            ticker: stringSchema,
            name: nullableStringSchema,
            opportunityScore: numberSchema,
          },
          required: ['assetId', 'ticker', 'name', 'opportunityScore'],
          additionalProperties: false,
        },
      },
    },
  ),
  tool('getVaults', 'List indexed Oren timelock vault positions.', {
    wallet: stringSchema,
  }),
  tool(
    'getLeaderboard',
    'Get the opt-in public social trading leaderboard ranked by observed portfolio P&L.',
    {
      timeframe: {
        type: ['string', 'null'],
        enum: ['7D', '30D', '90D', 'ALL', null],
      },
      limit: nullableNumberSchema,
    },
  ),
  tool(
    'getTraderProfile',
    'Get a public trader profile, observed portfolio, chart history, and activity.',
    {
      slug: stringSchema,
      timeframe: {
        type: ['string', 'null'],
        enum: ['7D', '30D', '90D', 'ALL', null],
      },
    },
  ),
  tool(
    'prepareCopyPortfolio',
    'Create a proposal-only basket that copies a public trader portfolio using a chosen USDC amount.',
    {
      sourceSlug: stringSchema,
      wallet: stringSchema,
      amountUsd: numberSchema,
    },
  ),
];

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
): ToolDefinition {
  return {
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function required(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${key} is required`);
  }
  return value.trim();
}

function optional(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

function optionalNumber(
  input: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`${key} is required`);
  }
  return value;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
