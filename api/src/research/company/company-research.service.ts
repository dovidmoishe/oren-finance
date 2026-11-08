import { Injectable } from '@nestjs/common';
import type { Equity } from '../../../types/equity';
import type { CompanyResearchData } from '../../../types/company-research';
import type { ResearchSource } from '../../../types/research';
import { assembleCompanyResearch } from './assemble';
import { createLiveSecClient, type SecEdgarClient } from './sec-client';

@Injectable()
export class CompanyResearchService {
  private readonly sec: SecEdgarClient = createLiveSecClient();

  load(
    equity: Equity,
    now = new Date(),
  ): Promise<ResearchSource<CompanyResearchData>> {
    return assembleCompanyResearch(equity, { sec: this.sec, now });
  }
}
