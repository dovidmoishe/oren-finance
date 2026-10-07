import { Inject, Injectable } from '@nestjs/common';
import type {
  PantaCategories,
  PantaMarket,
  PantaMarketPage,
  PantaMarketQuery,
} from '../../types/panta';
import { ProviderError } from '../common/errors/provider.errors';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import {
  invalidPantaPayload,
  mapPantaMarket,
  pantaSource,
  record,
} from './panta.mapper';

type Result = PantaMarket | PantaMarketPage | PantaCategories;
const FRESH_MS = 30_000;
const MAX_AGE_MS = 300_000;
const MAX_ENTRIES = 200;

@Injectable()
export class PantaService {
  private readonly cache = new Map<
    string,
    { value: Result; storedAt: number }
  >();
  private readonly inflight = new Map<string, Promise<Result>>();
  private retryAt = 0;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  listMarkets(query: PantaMarketQuery = {}): Promise<PantaMarketPage> {
    if (
      (query.limit !== undefined &&
        (!Number.isInteger(query.limit) ||
          query.limit < 1 ||
          query.limit > 50)) ||
      (query.status !== undefined &&
        !['primary', 'secondary', 'resolved', 'cancelled'].includes(
          query.status,
        )) ||
      (query.createdBy !== undefined && query.createdBy !== 'me')
    )
      throw new ProviderError('Invalid Panta filter', 'PANTA_BAD_REQUEST', 400);
    const params = new URLSearchParams();
    for (const key of ['category', 'status', 'createdBy', 'cursor'] as const) {
      if (query[key]) params.set(key, query[key]);
    }
    params.set('limit', String(query.limit ?? 20));
    return this.read(`/markets/?${params.toString()}`, (raw) => {
      const body = record(raw);
      if (
        !Array.isArray(body.items) ||
        (body.nextCursor != null && typeof body.nextCursor !== 'string')
      )
        throw invalidPantaPayload();
      const source = pantaSource();
      return {
        items: body.items.map((item: unknown) => mapPantaMarket(item, source)),
        nextCursor: body.nextCursor ?? null,
        source,
      };
    });
  }

  getMarket(marketId: string): Promise<PantaMarket> {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(marketId))
      throw new ProviderError('Invalid market ID', 'PANTA_BAD_REQUEST', 400);
    return this.read(`/markets/${encodeURIComponent(marketId)}/`, (raw) => {
      const market = mapPantaMarket(raw);
      if (market.marketId !== marketId) throw invalidPantaPayload();
      return market;
    });
  }

  getCategories(): Promise<PantaCategories> {
    return this.read('/categories/', (raw) => {
      const body = record(raw);
      if (
        !Array.isArray(body.categories) ||
        !body.categories.every((value: unknown) => typeof value === 'string')
      )
        throw invalidPantaPayload();
      return {
        categories: body.categories,
        source: pantaSource(),
      };
    });
  }

  private async read<T extends Result>(
    path: string,
    map: (raw: unknown) => T,
  ): Promise<T> {
    if (!this.env.PANTA_ENABLED)
      throw new ProviderError('Panta is disabled', 'PANTA_DISABLED', 503);
    if (!this.env.PANTA_API_BASE_URL || !this.env.PANTA_API_KEY)
      throw new ProviderError(
        'Panta is not configured',
        'PANTA_NOT_CONFIGURED',
        503,
      );
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.storedAt < FRESH_MS)
      return structuredClone(cached.value) as T;
    const pending = this.inflight.get(path);
    if (pending) return structuredClone(await pending) as T;
    const request = this.fetchRead(path)
      .then(map)
      .then((value) => {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
          if (now - entry.storedAt >= MAX_AGE_MS) this.cache.delete(key);
        }
        this.cache.delete(path);
        const oldest = Array.from(this.cache.keys())[0];
        if (this.cache.size >= MAX_ENTRIES && oldest !== undefined)
          this.cache.delete(oldest);
        this.cache.set(path, { value, storedAt: now });
        return value;
      })
      .catch((error: unknown) => {
        const transient =
          error instanceof ProviderError &&
          ['PANTA_UNAVAILABLE', 'PANTA_TIMEOUT', 'PANTA_RATE_LIMITED'].includes(
            error.code,
          );
        if (transient && cached && Date.now() - cached.storedAt < MAX_AGE_MS) {
          const value = structuredClone(cached.value);
          value.source.stale = true;
          if ('items' in value)
            value.items.forEach((item) => (item.source.stale = true));
          return value;
        }
        throw error;
      })
      .finally(() => this.inflight.delete(path));
    this.inflight.set(path, request);
    return structuredClone(await request) as T;
  }

  private async fetchRead(path: string): Promise<unknown> {
    if (Date.now() < this.retryAt)
      throw new ProviderError('Panta rate limited', 'PANTA_RATE_LIMITED', 429);
    const signal = AbortSignal.timeout(
      this.env.PANTA_REQUEST_TIMEOUT_MS ?? 8000,
    );
    try {
      const response = await fetch(`${this.env.PANTA_API_BASE_URL}${path}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': this.env.PANTA_API_KEY!,
          Accept: 'application/json',
        },
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 429) {
          const delay = Number(response.headers.get('Retry-After') ?? 60);
          this.retryAt =
            Date.now() +
            (Number.isFinite(delay) && delay >= 0 ? delay : 60) * 1000;
        }
        const codes: Record<number, string> = {
          400: 'PANTA_BAD_REQUEST',
          401: 'PANTA_UNAUTHORIZED',
          403: 'PANTA_FORBIDDEN',
          404: 'PANTA_NOT_FOUND',
          429: 'PANTA_RATE_LIMITED',
        };
        const code = codes[response.status] ?? 'PANTA_UNAVAILABLE';
        // Never expose upstream messages, response bodies or fetch causes.
        throw new ProviderError(
          'Panta request failed',
          code,
          response.status < 500 ? response.status : 502,
        );
      }
      try {
        return (await response.json()) as unknown;
      } catch {
        if (signal.aborted)
          throw new ProviderError(
            'Panta request timed out',
            'PANTA_TIMEOUT',
            504,
          );
        throw invalidPantaPayload();
      }
    } catch (error: unknown) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        signal.aborted ? 'Panta request timed out' : 'Panta unavailable',
        signal.aborted ? 'PANTA_TIMEOUT' : 'PANTA_UNAVAILABLE',
        signal.aborted ? 504 : 502,
      );
    }
  }
}
