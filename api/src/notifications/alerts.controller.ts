import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { PriceAlerts } from './alerts';

@Controller('me/price-alerts')
export class PriceAlertsController {
  constructor(
    private readonly auth: PrivyWalletAuth,
    private readonly alerts: PriceAlerts,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @Headers('authorization') authorization?: string,
    @Query('assetId') assetId?: string,
  ) {
    const { userId, emailVerified } =
      await this.auth.requireAccountIdentity(authorization);
    if (
      assetId !== undefined &&
      (typeof assetId !== 'string' || !/^[\w.-]{1,120}$/.test(assetId))
    ) {
      throw new BadRequestException('Invalid asset');
    }
    return this.alerts.list(userId, emailVerified, assetId);
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const { userId, emailVerified } =
      await this.auth.requireAccountIdentity(authorization);
    return this.alerts.create(userId, emailVerified, body);
  }

  @Delete(':id')
  async cancel(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const { userId } = await this.auth.requireAccountIdentity(authorization);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      throw new BadRequestException('Invalid alert');
    await this.alerts.cancel(userId, id);
    return { canceled: true };
  }
}
