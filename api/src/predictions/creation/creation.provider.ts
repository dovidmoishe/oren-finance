import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { ProviderError } from '../../common/errors/provider.errors';
import { record } from '../../panta/panta.mapper';
import type {
  CreationPayload,
  CreationQuote,
} from '../../../types/prediction-creation';
import { publicHttps } from './creation.validation';
const knownCodes = new Set([
  'INVALID_MARKET_PARAMS',
  'DUPLICATE_MARKET',
  'CREATE_NOT_PERMITTED',
  'CREATE_EXPIRED',
  'TX_NOT_FOUND',
  'TX_FAILED',
  'TX_MISMATCH',
  'TX_FEE_MISMATCH',
  'UPLOAD_NOT_CONFIGURED',
  'UNAUTHORIZED',
  'RATE_LIMITED',
]);
const fail = () =>
  new ProviderError(
    'Invalid Panta creation response',
    'PANTA_CREATE_INVALID_RESPONSE',
    502,
  );
export interface ProviderBuild {
  createId: string;
  expectedEventPda: string;
  transaction: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  buildFingerprint: string;
  paymentUsdc: string;
  liquidityInjectionUsdc: string;
  platformRevenueUsdc: string;
  expiresAt: string;
  derived: Record<string, string>;
}
function string(raw: Record<string, unknown>, name: string) {
  const v = raw[name];
  if (typeof v !== 'string' || !v || v.length > 100_000) throw fail();
  return v;
}
function amount(raw: Record<string, unknown>, name: string) {
  const v = string(raw, name);
  if (!/^\d{1,30}$/.test(v)) throw fail();
  return v;
}
@Injectable()
export class CreationProvider {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}
  private async post(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    if (
      !this.env.PANTA_ENABLED ||
      !this.env.PANTA_CREATION_ENABLED ||
      !this.env.PANTA_API_BASE_URL ||
      !this.env.PANTA_API_KEY
    )
      throw new ProviderError(
        'Panta publication is disabled',
        'PANTA_CREATE_DISABLED',
        503,
      );
    try {
      const response = await fetch(`${this.env.PANTA_API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.env.PANTA_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.env.PANTA_REQUEST_TIMEOUT_MS ?? 8000),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code =
          raw &&
          typeof raw === 'object' &&
          'code' in raw &&
          typeof raw.code === 'string' &&
          knownCodes.has(raw.code)
            ? raw.code
            : response.status === 429
              ? 'RATE_LIMITED'
              : response.status === 401
                ? 'UNAUTHORIZED'
                : 'UNAVAILABLE';
        throw new ProviderError(
          'Panta creation request failed',
          `PANTA_CREATE_${code}`,
          response.status < 500 ? response.status : 502,
        );
      }
      return record(raw);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        'Panta creation request unavailable or timed out',
        'PANTA_CREATE_UNAVAILABLE',
        502,
      );
    }
  }
  async upload(png: Buffer) {
    if (png.length > 5 * 1024 * 1024) throw fail();
    const raw = await this.post('/markets/create/image-upload/', {});
    let url: URL;
    try {
      url = new URL(string(raw, 'uploadUrl'));
    } catch {
      throw fail();
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'api.cloudinary.com' ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/v1_1\/[A-Za-z0-9_-]+\/image\/upload$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      throw fail();
    if (
      !Number.isFinite(Date.parse(string(raw, 'expiresAt'))) ||
      Date.parse(raw.expiresAt as string) <= Date.now()
    )
      throw fail();
    const fields = record(raw.fields),
      form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw fail();
      form.set(key, String(value));
    }
    form.set(
      'file',
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      'oren-prediction.png',
    );
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw fail();
      const result = record(await response.json());
      const imageUrl = string(result, 'secure_url');
      if (
        !publicHttps(imageUrl) ||
        new URL(imageUrl).hostname !== 'res.cloudinary.com'
      )
        throw fail();
      return imageUrl;
    } catch {
      throw new ProviderError(
        'Artwork upload failed',
        'PANTA_CREATE_UPLOAD_FAILED',
        502,
      );
    }
  }
  async quote(
    payload: CreationPayload,
  ): Promise<Omit<CreationQuote, 'payloadHash' | 'version'>> {
    const raw = await this.post('/markets/create/quote/', payload);
    const result = {
      createId: string(raw, 'createId'),
      expectedEventPda: string(raw, 'expectedEventPda'),
      paymentUsdc: amount(raw, 'paymentUsdc'),
      liquidityInjectionUsdc: amount(raw, 'liquidityInjectionUsdc'),
      platformRevenueUsdc: amount(raw, 'platformRevenueUsdc'),
      expiresAt: string(raw, 'expiresAt'),
    };
    if (
      raw.marketType !== 'standard' ||
      BigInt(result.liquidityInjectionUsdc) +
        BigInt(result.platformRevenueUsdc) !==
        BigInt(result.paymentUsdc) ||
      !(Date.parse(result.expiresAt) > Date.now())
    )
      throw fail();
    return result;
  }
  async build(createId: string, wallet: string): Promise<ProviderBuild> {
    const raw = await this.post('/markets/create/build/', { createId, wallet });
    const derived = record(raw.derived);
    if (
      Object.values(derived).some((v) => typeof v !== 'string') ||
      !Number.isSafeInteger(raw.lastValidBlockHeight)
    )
      throw fail();
    return {
      createId: string(raw, 'createId'),
      expectedEventPda: string(raw, 'expectedEventPda'),
      transaction: string(raw, 'transaction'),
      recentBlockhash: string(raw, 'recentBlockhash'),
      lastValidBlockHeight: raw.lastValidBlockHeight as number,
      buildFingerprint: string(raw, 'buildFingerprint'),
      paymentUsdc: amount(raw, 'paymentUsdc'),
      liquidityInjectionUsdc: amount(raw, 'liquidityInjectionUsdc'),
      platformRevenueUsdc: amount(raw, 'platformRevenueUsdc'),
      expiresAt: string(raw, 'expiresAt'),
      derived: derived as Record<string, string>,
    };
  }
  async register(createId: string, signature: string, event: string) {
    const raw = await this.post('/markets/register/', { createId, signature });
    if (
      raw.status !== 'registered' ||
      raw.marketId !== event ||
      raw.signature !== signature ||
      raw.createId !== createId
    )
      throw fail();
    return event;
  }
}
