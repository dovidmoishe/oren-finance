import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import type { CreationTerms } from '../../../types/prediction-creation';
import { CreationSessionService } from './creation-session.service';
import { PredictionCreationService } from './creation.service';
class ChallengeDto {
  @IsString() @MaxLength(44) wallet!: string;
}
class SessionDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) nonce!: string;
  @IsString() @MaxLength(100) signature!: string;
}
class ProposeDto {
  @IsString() @MinLength(1) @MaxLength(4000) intent!: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
}
class TermsDto implements CreationTerms {
  @IsIn(['stock_threshold', 'stock_versus', 'crypto_threshold', 'macro'])
  template!: CreationTerms['template'];
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  assetIds!: string[];
  @IsString() @MaxLength(512) title!: string;
  @IsString() @MaxLength(512) question!: string;
  @IsString() @MaxLength(4000) description!: string;
  @IsString() @MaxLength(2048) resolutionRule!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  sourcesOfTruth!: string[];
  @IsIn(['finance', 'crypto', 'world']) category!: CreationTerms['category'];
  @IsInt() startTime!: number;
  @IsInt() endTime!: number;
  @IsInt() resolutionTime!: number;
  @IsString() @MaxLength(100) timezone!: string;
  @IsString() @MaxLength(600) measurement!: string;
  @IsString() @MaxLength(600) observationPolicy!: string;
  @IsString() @MaxLength(600) missingDataPolicy!: string;
  @IsIn(['NO']) tiePolicy!: 'NO';
  @IsIn(['standard']) marketType!: 'standard';
  @IsIn(['Global']) region!: 'Global';
}
class RevisionDto {
  @IsInt() @Min(1) version!: number;
  @ValidateNested() @Type(() => TermsDto) terms!: TermsDto;
  @IsBoolean() research!: boolean;
}
class VersionDto {
  @IsInt() @Min(1) version!: number;
}
class PrepareDto {
  @IsUUID() draftId!: string;
  @IsInt() @Min(1) version!: number;
  @IsString() @MaxLength(150) createId!: string;
  @Matches(/^[a-f0-9]{64}$/) payloadHash!: string;
  @Matches(/^\d{1,30}$/) paymentUsdc!: string;
  @IsBoolean() allowDuplicate!: boolean;
}
class ConfirmDto {
  @IsUUID() draftId!: string;
  @IsUUID() attemptId!: string;
  @IsString() @MaxLength(100) signature!: string;
}
function cancellation(request: Request, response: Response) {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  response.once('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  return controller.signal;
}
@Controller('predictions/creation')
export class CreationController {
  constructor(
    private readonly creation: PredictionCreationService,
    private readonly sessions: CreationSessionService,
  ) {}
  @Post('session/challenge') challenge(@Body() input: ChallengeDto) {
    return this.sessions.challenge(input.wallet);
  }
  @Post('session') session(@Body() input: SessionDto) {
    return this.sessions.exchange(input.nonce, input.signature);
  }
  @Post('propose') propose(
    @Headers('authorization') token: string | undefined,
    @Body() input: ProposeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.creation.propose(
      this.sessions.require(token),
      input,
      cancellation(request, response),
    );
  }
  @Get(':draftId') get(
    @Headers('authorization') token: string | undefined,
    @Param('draftId', new ParseUUIDPipe()) id: string,
  ) {
    return this.creation.get(this.sessions.require(token), id);
  }
  @Patch(':draftId') revise(
    @Headers('authorization') token: string | undefined,
    @Param('draftId', new ParseUUIDPipe()) id: string,
    @Body() input: RevisionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.creation.revise(
      this.sessions.require(token),
      id,
      input,
      cancellation(request, response),
    );
  }
  @Post(':draftId/quote') quote(
    @Headers('authorization') token: string | undefined,
    @Param('draftId', new ParseUUIDPipe()) id: string,
    @Body() input: VersionDto,
  ) {
    return this.creation.quote(this.sessions.require(token), id, input.version);
  }
  @Post('prepare') prepare(
    @Headers('authorization') token: string | undefined,
    @Body() input: PrepareDto,
  ) {
    return this.creation.prepare(this.sessions.require(token), input);
  }
  @Post('confirm') confirm(
    @Headers('authorization') token: string | undefined,
    @Body() input: ConfirmDto,
  ) {
    return this.creation.confirm(this.sessions.require(token), input);
  }
  @Post(':draftId/release-expired') release(
    @Headers('authorization') token: string | undefined,
    @Param('draftId', new ParseUUIDPipe()) id: string,
  ) {
    return this.creation.releaseExpired(this.sessions.require(token), id);
  }
}
