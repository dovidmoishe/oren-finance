import { BadRequestException, Injectable } from '@nestjs/common';
import type { EquitySummary } from '../../types/equity';
import type { PantaMarket } from '../../types/panta';
import type {
  PredictionMarket,
  PredictionResults,
  PredictionSearch,
} from '../../types/predictions';
import { ProviderError } from '../common/errors/provider.errors';
import { MarketService } from '../market/market.service';
import { PantaService } from '../panta/panta.service';

const MACRO =
  /\b(inflation|interest rates?|rate cuts?|rate hikes?|federal reserve|fed|central banks?|employment|unemployment|jobs report|payrolls|gdp|economic policy|monetary policy|fiscal policy|cpi)\b/i;
const CATEGORIES = ['finance', 'crypto', 'world'] as const;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function investingMarket(market: PantaMarket): boolean {
  return (
    market.category === 'finance' ||
    market.category === 'crypto' ||
    (market.category === 'world' && MACRO.test(market.title))
  );
}

export function matchStocks(title: string, directory: EquitySummary[]) {
  const tickerIds = new Map<string, Set<string>>();
  const nameIds = new Map<string, Set<string>>();
  for (const stock of directory) {
    for (const [index, key] of [
      [tickerIds, stock.ticker],
      [nameIds, stock.name.toLowerCase()],
    ] as const) {
      const ids = index.get(key) ?? new Set<string>();
      ids.add(stock.id);
      index.set(key, ids);
    }
  }
  const matched = directory.filter((stock) => {
    const ticker = new RegExp(
      `(?:^|[^A-Za-z0-9])\\$?${escape(stock.ticker)}(?=$|[^A-Za-z0-9])`,
    );
    const name = new RegExp(
      `(?:^|[^A-Za-z0-9])${escape(stock.name)}(?=$|[^A-Za-z0-9])`,
      'i',
    );
    return (
      (tickerIds.get(stock.ticker)?.size === 1 && ticker.test(title)) ||
      (nameIds.get(stock.name.toLowerCase())?.size === 1 && name.test(title))
    );
  });
  return [
    ...new Map(
      matched.map((s) => [s.id, { assetId: s.id, ticker: s.ticker }]),
    ).values(),
  ];
}

export function decorateMarket(
  market: PantaMarket,
  directory: EquitySummary[],
): PredictionMarket {
  const stockLinks = matchStocks(market.title, directory);
  const kind = stockLinks.length
    ? 'direct'
    : MACRO.test(market.title)
      ? 'macro'
      : 'general';
  return {
    ...market,
    stockLinks,
    relevance: {
      kind,
      reason:
        kind === 'direct'
          ? `Names ${stockLinks.map((s) => s.ticker).join(', ')}`
          : kind === 'macro'
            ? 'Economic event may provide context for equities; price impact is not quantified.'
            : 'Investing market; no direct stock match.',
    },
  };
}

function compareDecimal(a: string | null, b: string | null): number {
  const parts = (s: string) => {
    const [i, f = ''] = s.split('.');
    return [i.replace(/^0+/, '') || '0', f] as const;
  };
  const [ai, af] = parts(a ?? '0'),
    [bi, bf] = parts(b ?? '0');
  if (ai.length !== bi.length) return ai.length - bi.length;
  if (ai !== bi) return ai > bi ? 1 : -1;
  const n = Math.max(af.length, bf.length);
  return af.padEnd(n, '0').localeCompare(bf.padEnd(n, '0'));
}

@Injectable()
export class PredictionsService {
  constructor(
    private readonly panta: PantaService,
    private readonly market: MarketService,
  ) {}

  private async directory(): Promise<{
    items: EquitySummary[];
    warning?: string;
  }> {
    try {
      const catalog = await this.market.listStocks(1, 1000);
      return {
        items: catalog.items,
        warning: catalog.pagination.hasMore
          ? 'Stock associations use the first 1000 canonical stocks.'
          : undefined,
      };
    } catch {
      return {
        items: [],
        warning:
          'Canonical stock directory unavailable; stock associations are unresolved.',
      };
    }
  }

  async detail(id: string): Promise<PredictionMarket> {
    const [raw, directory] = await Promise.all([
      this.panta.getMarket(id),
      this.directory(),
    ]);
    if (!investingMarket(raw))
      throw new ProviderError(
        'Market is outside investing discovery',
        'PREDICTION_NOT_FOUND',
        404,
      );
    return decorateMarket(raw, directory.items);
  }

  async search(input: PredictionSearch = {}): Promise<PredictionResults> {
    const page = input.page ?? 1,
      limit = input.limit ?? 12;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (input.q?.length ?? 0) > 200 ||
      (input.assetIds?.length ?? 0) > 50 ||
      (input.category && !CATEGORIES.includes(input.category)) ||
      (input.phase &&
        !['primary', 'secondary', 'resolved', 'cancelled'].includes(
          input.phase,
        ))
    )
      throw new BadRequestException('Invalid prediction search');
    const directory = await this.directory();
    const warnings: string[] = directory.warning ? [directory.warning] : [];
    let complete = true,
      scanned = 0;
    const categories = input.category ? [input.category] : [...CATEGORIES];
    // Sequential pages per category, independent categories in parallel.
    const scans = await Promise.all(
      categories.map(async (category) => {
        const rows: PantaMarket[] = [];
        let cursor: string | undefined;
        try {
          for (let i = 0; i < 2; i++) {
            const result = await this.panta.listMarkets({
              category,
              status: input.phase,
              limit: 50,
              cursor,
            });
            scanned += result.scanned ?? result.items.length;
            if (result.warnings?.length) {
              complete = false;
              warnings.push(
                ...result.warnings.map((warning) => `${category}: ${warning}`),
              );
            }
            rows.push(...result.items);
            if (result.source.stale)
              warnings.push(`${category}: cached market data is stale.`);
            cursor = result.nextCursor ?? undefined;
            if (!cursor) break;
          }
          if (cursor) {
            complete = false;
            warnings.push(`${category}: scan limited to 100 markets.`);
          }
        } catch {
          complete = false;
          warnings.push(
            `${category}: market read failed; results are partial.`,
          );
        }
        return rows;
      }),
    );
    if (
      scans.every((rows) => rows.length === 0) &&
      warnings.some((w) => w.includes('read failed'))
    )
      throw new ProviderError(
        'Investing markets could not be loaded; retry discovery.',
        'PREDICTIONS_UNAVAILABLE',
        503,
      );
    const terms =
      input.q?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const ids = new Set(input.assetIds ?? []);
    const rows = [
      ...new Map(scans.flat().map((row) => [row.marketId, row])).values(),
    ]
      .filter(investingMarket)
      .filter((row) =>
        input.phase
          ? row.phase === input.phase
          : ['primary', 'secondary'].includes(row.phase),
      )
      .map((row) => decorateMarket(row, directory.items))
      .filter(
        (row) =>
          !ids.size ||
          row.stockLinks.some((s) => ids.has(s.assetId)) ||
          row.relevance.kind === 'macro',
      )
      .filter(
        (row) =>
          !terms.length ||
          terms.some((t) =>
            `${row.title} ${row.description ?? ''}`.toLowerCase().includes(t),
          ),
      );
    const score = (row: PredictionMarket) => [
      row.stockLinks.some((s) => ids.has(s.assetId))
        ? 2
        : row.stockLinks.length
          ? 1
          : 0,
      terms.filter((t) => row.title.toLowerCase().includes(t)).length,
      row.relevance.kind === 'macro' ? 1 : 0,
      row.source.stale ? 0 : 1,
    ];
    rows.sort((a, b) => {
      const x = score(a),
        y = score(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
      return (
        compareDecimal(b.volumeUsdc, a.volumeUsdc) ||
        a.marketId.localeCompare(b.marketId)
      );
    });
    const offset = (page - 1) * limit;
    return {
      items: rows.slice(offset, offset + limit),
      page,
      hasMore: offset + limit < rows.length,
      coverage: { scanned, complete, warnings: [...new Set(warnings)] },
    };
  }
}
