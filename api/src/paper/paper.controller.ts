import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { PAPER_MODEL } from '../../types/paper';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { STRATEGIES } from './strategy';
import { PaperService } from './paper.service';

const start = z
  .object({
    assetId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    strategy: z.enum(STRATEGIES),
  })
  .strict();

@Controller('me/paper-runs')
export class PaperController {
  constructor(
    private readonly auth: PrivyWalletAuth,
    private readonly service: PaperService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}
  private async owner(token?: string) {
    if (!this.env.PAPER_TRADING_ENABLED) throw new NotFoundException();
    return (await this.auth.requireAccountIdentity(token)).userId;
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Headers('authorization') token?: string) {
    return {
      strategies: STRATEGIES,
      model: PAPER_MODEL,
      runs: await this.service.list(await this.owner(token)),
    };
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  async start(@Body() body: unknown, @Headers('authorization') token?: string) {
    const owner = await this.owner(token);
    const parsed = start.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Expected canonical assetId and supported strategy',
      );
    return this.service.start(owner, parsed.data.assetId, parsed.data.strategy);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async activity(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') token?: string,
    @Query('before') before?: string,
  ) {
    const owner = await this.owner(token);
    if (before !== undefined && !/^\d{1,14}$/.test(before))
      throw new BadRequestException(
        'before must be a bar timestamp in milliseconds',
      );
    return this.service.activity(
      owner,
      id,
      before === undefined ? undefined : Number(before),
    );
  }
  @Put(':id/active')
  @Header('Cache-Control', 'private, no-store')
  async active(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Headers('authorization') token?: string,
  ) {
    const owner = await this.owner(token);
    const state = z.object({ active: z.boolean() }).strict().safeParse(body);
    if (!state.success)
      throw new BadRequestException('Expected active boolean');
    return this.service.setActive(owner, id, state.data.active);
  }
}
