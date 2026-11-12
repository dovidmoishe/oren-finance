import { Controller, Get, Header, Headers, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type {
  GetMarketOpportunitiesResponse,
  GetMarketTrendingResponse,
} from '../../types/api';
import type { MarketForYouResponse } from '../../types/equity';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { PreferencesReader } from '../preferences/preferences-reader';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { MarketService } from './market.service';

class OpportunitiesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minScore?: number;
}

@Controller('markets')
export class MarketsController {
  constructor(
    private readonly market: MarketService,
    private readonly intelligence: IntelligenceService,
    private readonly auth: PrivyWalletAuth,
    private readonly preferences: PreferencesReader,
  ) {}

  @Get('for-you')
  @Header('Cache-Control', 'private, no-store')
  async forYou(
    @Headers('authorization') authorization?: string,
  ): Promise<MarketForYouResponse> {
    const { userId } = await this.auth.requireAccountIdentity(authorization);
    return this.market.getForYou(await this.preferences.getSectors(userId));
  }

  @Get('trending')
  trending(): Promise<GetMarketTrendingResponse> {
    return this.market.getTrending();
  }

  @Get('opportunities')
  opportunities(
    @Query() query: OpportunitiesQueryDto,
  ): Promise<GetMarketOpportunitiesResponse> {
    return this.intelligence.getOpportunities({
      limit: query.limit,
      minScore: query.minScore,
    });
  }
}
