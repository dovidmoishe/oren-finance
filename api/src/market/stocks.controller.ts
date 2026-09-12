import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type {
  GetStockChartResponse,
  GetStockResponse,
  GetStocksResponse,
  SearchStocksResponse,
} from '../../types/api';
import type { ChartRange } from '../../types/market';
import { MarketService } from './market.service';

class SearchStocksDto {
  @IsString()
  @MinLength(1)
  q!: string;
}

class ChartQueryDto {
  @IsOptional()
  @IsIn(['1D', '1W', '1M', '3M', '1Y', 'ALL'])
  range?: ChartRange;
}

@Controller('stocks')
export class StocksController {
  constructor(private readonly market: MarketService) {}

  @Get()
  list(): Promise<GetStocksResponse> {
    return this.market.listStocks();
  }

  @Get('search')
  search(@Query() query: SearchStocksDto): Promise<SearchStocksResponse> {
    const q = query.q?.trim();
    if (!q) {
      throw new BadRequestException('Query parameter "q" is required');
    }
    return this.market.searchStocks(q);
  }

  @Get(':assetId/chart')
  chart(
    @Param('assetId') assetId: string,
    @Query() query: ChartQueryDto,
  ): Promise<GetStockChartResponse> {
    const range: ChartRange = query.range ?? '1M';
    return this.market.getChart(assetId, range);
  }

  @Get(':assetId')
  detail(@Param('assetId') assetId: string): Promise<GetStockResponse> {
    return this.market.getStock(assetId);
  }
}
