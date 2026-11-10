import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { SenviokEmailService } from '../senviok/senviok.service';
import { TradeEmailRepository } from './trade-email.repository';

@Controller('notifications/trade-email')
export class TradeEmailController {
  constructor(
    private readonly auth: PrivyWalletAuth,
    private readonly emails: SenviokEmailService,
    private readonly repository: TradeEmailRepository,
  ) {}

  @Get()
  async getPreference(
    @Query('walletAddress') walletAddress: string,
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    return {
      enabled: await this.repository.enabled(identity.userId),
      emailAvailable: Boolean(identity.email),
      ready: Boolean(identity.email && this.emails.isConfigured),
    };
  }

  @Put()
  async setPreference(
    @Query('walletAddress') walletAddress: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    const enabled = parseEnabled(body);
    if (enabled && !identity.email)
      throw new BadRequestException(
        'Link an email address to your Oren account before enabling receipts',
      );
    if (enabled && !this.emails.isConfigured)
      throw new ServiceUnavailableException(
        'Trade email receipts are not available right now',
      );

    await this.repository.setEnabled(identity.userId, enabled);
    return {
      enabled,
      emailAvailable: Boolean(identity.email),
      ready: Boolean(identity.email && this.emails.isConfigured),
    };
  }
}

function requiredWallet(value: string | undefined): string {
  if (!value?.trim())
    throw new BadRequestException('walletAddress is required');
  return value.trim();
}

function parseEnabled(body: unknown): boolean {
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).enabled !== 'boolean'
  )
    throw new BadRequestException('enabled must be a boolean');
  return (body as { enabled: boolean }).enabled;
}
