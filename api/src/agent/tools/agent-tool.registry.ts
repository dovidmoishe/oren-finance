import { BadRequestException, Injectable } from '@nestjs/common';
import type { AgentArtifact } from '../../../types/agent';
import type { TradeIntent } from '../../../types/execution';
import type { ChartRange } from '../../../types/market';
import { ExecutionService } from '../../execution/execution.service';
import { IntelligenceService } from '../../intelligence/intelligence.service';
import { MarketService } from '../../market/market.service';
import { NewsService } from '../../news/news.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
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
  ) {}

  getSchemas(): ToolDefinition[] {
    return TOOL_SCHEMAS;
  }

  async dispatch(name: string, args: unknown): Promise<AgentToolResult> {
    const input = asRecord(args);

    switch (name) {
      case 'getPortfolio':
        return {
          output: await this.portfolio.getPortfolio(required(input, 'wallet')),
        };

      case 'getPortfolioActivity':
        return {
          output: await this.portfolio.getActivity(required(input, 'wallet')),
        };

      case 'getStock': {
        const stock = await this.getStockByInput(
          required(input, 'assetIdOrTicker'),
        );
        return { output: stock };
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
        return {
          output: await this.vault.listVaults(required(input, 'wallet')),
        };

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

const TOOL_SCHEMAS: ToolDefinition[] = [
  tool('getPortfolio', 'Get the user portfolio for a Solana wallet.', {
    wallet: stringSchema,
  }),
  tool('getPortfolioActivity', 'Get Oren and wallet activity for a wallet.', {
    wallet: stringSchema,
  }),
  tool('getStock', 'Get canonical stock detail by asset id or ticker.', {
    assetIdOrTicker: stringSchema,
  }),
  tool(
    'getStockChart',
    'Get normalized stock chart candles.',
    {
      assetIdOrTicker: stringSchema,
      range: { type: 'string', enum: ['1D', '1W', '1M', '3M', '1Y', 'ALL'] },
    },
    ['assetIdOrTicker'],
  ),
  tool('getStockNews', 'Get recent news for a canonical stock.', {
    assetIdOrTicker: stringSchema,
  }),
  tool(
    'analyzeStock',
    'Get deterministic Oren Score and analysis for a stock.',
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
      minScore: numberSchema,
      limit: numberSchema,
    },
    [],
  ),
  tool('getSignals', 'Get deterministic quantitative signals for a stock.', {
    assetIdOrTicker: stringSchema,
  }),
  tool(
    'getSwapQuote',
    'Get a Jupiter quote for buying or selling a stock.',
    {
      side: { type: 'string', enum: ['buy', 'sell'] },
      ticker: stringSchema,
      assetId: stringSchema,
      amountUsd: numberSchema,
      amount: numberSchema,
      preferredMint: stringSchema,
      slippageBps: numberSchema,
    },
    ['side'],
  ),
  tool(
    'prepareSwap',
    'Prepare an unsigned swap transaction for wallet review.',
    {
      quoteId: stringSchema,
      wallet: stringSchema,
    },
  ),
  tool(
    'createBasket',
    'Planned basket creation tool.',
    {
      amountUsd: numberSchema,
      prompt: stringSchema,
      wallet: stringSchema,
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            assetId: stringSchema,
            ticker: stringSchema,
            name: stringSchema,
            opportunityScore: numberSchema,
            signals: { type: 'object', additionalProperties: true },
          },
          required: ['assetId', 'ticker', 'opportunityScore'],
          additionalProperties: true,
        },
      },
    },
    ['amountUsd', 'prompt'],
  ),
  tool(
    'prepareBasketPurchase',
    'Prepare unsigned swap transactions for a basket purchase.',
    {
      basketId: stringSchema,
      wallet: stringSchema,
    },
  ),
  tool('getVaults', 'List indexed Oren timelock vault positions.', {
    wallet: stringSchema,
  }),
  tool('prepareLock', 'Prepare an unsigned vault lock transaction.', {
    wallet: stringSchema,
    asset: stringSchema,
    amount: numberSchema,
    unlockAt: stringSchema,
  }),
  tool('prepareUnlock', 'Prepare an unsigned vault unlock transaction.', {
    wallet: stringSchema,
    lockAddress: stringSchema,
  }),
];

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  requiredFields = Object.keys(properties),
): ToolDefinition {
  return {
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required: requiredFields,
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
