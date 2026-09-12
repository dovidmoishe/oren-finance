import { Controller, Get } from '@nestjs/common';
import type { GetMarketTrendingResponse } from '../../types/api';
import { MarketService } from './market.service';

@Controller('markets')
export class MarketsController {
  constructor(private readonly market: MarketService) {}

  @Get('trending')
  trending(): Promise<GetMarketTrendingResponse> {
    return this.market.getTrending();
  }
}
