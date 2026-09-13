import { Body, Controller, Post } from '@nestjs/common';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type {
  PostBasketRequest,
  PostBasketResponse,
  PostExecutionConfirmRequest,
  PostExecutionConfirmResponse,
  PostExecutionPrepareRequest,
  PostExecutionPrepareResponse,
  PostExecutionQuoteResponse,
} from '../../types/api';
import type {
  BasketCandidate,
  PreparedBasketPurchase,
  QuoteRequest,
  TradeIntent,
} from '../../types/execution';
import type { TradeSide } from '../../types/quote';
import { ExecutionService } from './execution.service';

/** Accepts either TradeIntent or mint-level QuoteRequest fields. */
class ExecutionQuoteDto {
  @IsIn(['buy', 'sell'])
  side!: TradeSide;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  ticker?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  amountUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  amount?: number;

  @IsOptional()
  @IsString()
  preferredMint?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  slippageBps?: number;

  @IsOptional()
  @IsString()
  inputMint?: string;

  @IsOptional()
  @IsString()
  outputMint?: string;

  @IsOptional()
  @IsString()
  wallet?: string;
}

class ExecutionPrepareDto implements PostExecutionPrepareRequest {
  @IsString()
  @MinLength(1)
  quoteId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;
}

class ExecutionConfirmDto implements PostExecutionConfirmRequest {
  @IsString()
  @MinLength(1)
  quoteId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

class BasketCandidateDto {
  @IsString()
  @MinLength(1)
  assetId!: string;

  @IsString()
  @MinLength(1)
  ticker!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsNumber()
  @Min(0)
  opportunityScore!: number;
}

class BasketCreateDto implements PostBasketRequest {
  @IsNumber()
  @Min(0.000001)
  amountUsd!: number;

  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsOptional()
  @IsString()
  wallet?: string;

  @IsOptional()
  candidates?: BasketCandidateDto[];
}

class BasketPrepareDto {
  @IsString()
  @MinLength(1)
  basketId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;
}

@Controller('execution')
export class ExecutionController {
  constructor(private readonly execution: ExecutionService) {}

  @Post('quote')
  quote(@Body() body: ExecutionQuoteDto): Promise<PostExecutionQuoteResponse> {
    return this.execution.getQuote(body as TradeIntent | QuoteRequest);
  }

  @Post('prepare')
  prepare(
    @Body() body: ExecutionPrepareDto,
  ): Promise<PostExecutionPrepareResponse> {
    return this.execution.prepare(body);
  }

  @Post('confirm')
  confirm(
    @Body() body: ExecutionConfirmDto,
  ): Promise<PostExecutionConfirmResponse> {
    return this.execution.confirm(body);
  }

  @Post('basket')
  basket(@Body() body: BasketCreateDto): Promise<PostBasketResponse> {
    return this.execution.createBasket({
      ...body,
      candidates: body.candidates as BasketCandidate[] | undefined,
    });
  }

  @Post('basket/prepare')
  prepareBasket(
    @Body() body: BasketPrepareDto,
  ): Promise<PreparedBasketPurchase> {
    return this.execution.prepareBasketPurchase(body);
  }
}
