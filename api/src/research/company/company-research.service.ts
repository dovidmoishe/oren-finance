import { Inject, Injectable } from '@nestjs/common';
import type { Equity } from '../../../types/equity';
import type { CompanyResearchData } from '../../../types/company-research';
import type { ResearchSource } from '../../../types/research';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { assembleCompanyResearch } from './assemble';
import {
  secEdgarAccess,
  tryHoldSecWorkerLock,
  type SecAccess,
} from './sec-access';
import {
  createLiveSecClient,
  SecFetchError,
  type SecCompanySnapshot,
  type SecEdgarClient,
} from './sec-client';

@Injectable()
export class CompanyResearchService {
  private gate?: Promise<SecAccess>;
  private client?: SecEdgarClient;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  load(
    equity: Equity,
    now = new Date(),
  ): Promise<ResearchSource<CompanyResearchData>> {
    return this.ready().then((access) =>
      assembleCompanyResearch(equity, {
        sec: access.enabled ? this.client! : disabledSec(access.reason),
        now,
      }),
    );
  }

  private ready(): Promise<SecAccess> {
    this.gate ??= this.open();
    return this.gate;
  }

  private async open(): Promise<SecAccess> {
    const access = secEdgarAccess({
      ...this.env,
      NODE_APP_INSTANCE: process.env.NODE_APP_INSTANCE,
      WEB_CONCURRENCY: process.env.WEB_CONCURRENCY,
    });
    if (!access.enabled) return access;
    const held = await tryHoldSecWorkerLock(this.env.POSTGRES_URL).catch(
      () => false,
    );
    if (!held) return { enabled: false, reason: 'sec_worker_unavailable' };
    this.client = createLiveSecClient(access.userAgent);
    return access;
  }
}

function disabledSec(reason: Exclude<SecAccess, { enabled: true }>['reason']): {
  loadCompany(cik: string): Promise<SecCompanySnapshot>;
} {
  return {
    loadCompany: () =>
      Promise.reject(new SecFetchError(reason, { retryable: false })),
  };
}
