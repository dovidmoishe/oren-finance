import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import type {
  GetStockAnalysisResponse,
  GetStockChartResponse,
  GetStockChartsResponse,
  GetStockResponse,
  GetStocksResponse,
  SearchStocksResponse,
} from '../../types/api';
import type { ChartInterval, ChartRange } from '../../types/market';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { MarketService } from './market.service';

class SearchStocksDto {
  @IsString()
  @MinLength(1)
  q!: string;
}

class ListStocksDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ChartQueryDto {
  @IsOptional()
  @IsIn(['1D', '1W', '1M', '3M', '1Y', 'ALL'])
  range?: ChartRange;

  @IsOptional()
  @IsIn(['1m', '5m', '15m', '1H', '4H', '1D'])
  interval?: ChartInterval;
}

export class ChartsQueryDto extends ChartQueryDto {
  @IsString()
  @MinLength(1)
  ids!: string;
}

@Controller('stocks')
export class StocksController {
  constructor(
    private readonly market: MarketService,
    private readonly intelligence: IntelligenceService,
  ) {}

  @Get()
  list(@Query() query: ListStocksDto): Promise<GetStocksResponse> {
    return this.market.listStocks(query.page ?? 1, query.limit ?? 20);
  }

  @Get('search')
  search(@Query() query: SearchStocksDto): Promise<SearchStocksResponse> {
    const q = query.q?.trim();
    if (!q) {
      throw new BadRequestException('Query parameter "q" is required');
    }
    return this.market.searchStocks(q);
  }

  @Get('charts')
  charts(@Query() query: ChartsQueryDto): Promise<GetStockChartsResponse> {
    const ids = query.ids.split(',').map((id) => id.trim());
    if (ids.length > 20 || ids.some((id) => !id)) {
      throw new BadRequestException(
        'Provide between 1 and 20 non-empty asset ids',
      );
    }
    return this.market.getCharts(
      [...new Set(ids)],
      query.range ?? '1M',
      query.interval,
    );
  }

  @Get(':assetId/chart')
  chart(
    @Param('assetId') assetId: string,
    @Query() query: ChartQueryDto,
  ): Promise<GetStockChartResponse> {
    const range: ChartRange = query.range ?? '1M';
    return this.market.getChart(assetId, range, query.interval);
  }

  @Get(':assetId/analysis')
  async analysis(
    @Param('assetId') assetId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GetStockAnalysisResponse> {
    const analysis = await this.intelligence.getAnalysis(assetId);
    response.setHeader(
      'Cache-Control',
      'public, max-age=30, stale-while-revalidate=120',
    );
    return analysis;
  }

  @Get(':assetId')
  detail(@Param('assetId') assetId: string): Promise<GetStockResponse> {
    return this.market.getStock(assetId);
  }
}
