import { Controller, Get, Param, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { PredictionSearch } from '../../types/predictions';
import { PredictionsService } from './predictions.service';

class SearchDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional()
  @IsIn(['finance', 'crypto', 'world'])
  category?: PredictionSearch['category'];
  @IsOptional()
  @IsIn(['primary', 'secondary', 'resolved', 'cancelled'])
  phase?: PredictionSearch['phase'];
  @IsOptional() @IsString() @MaxLength(3000) assetIds?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
@Controller('predictions')
export class PredictionsController {
  constructor(private readonly predictions: PredictionsService) {}
  @Get('markets') search(@Query() query: SearchDto) {
    return this.predictions.search({
      ...query,
      assetIds: query.assetIds?.split(',').filter(Boolean),
    });
  }
  @Get('markets/:marketId') detail(@Param('marketId') id: string) {
    return this.predictions.detail(id);
  }
}
