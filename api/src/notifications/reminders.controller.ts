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
} from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { ReleaseReminders } from './reminders';

@Controller('me/release-reminders')
export class ReleaseRemindersController {
  constructor(
    private readonly auth: PrivyWalletAuth,
    private readonly reminders: ReleaseReminders,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Headers('authorization') authorization?: string) {
    const { userId, emailVerified } =
      await this.auth.requireAccountIdentity(authorization);
    return this.reminders.list(userId, emailVerified);
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const { userId, emailVerified } =
      await this.auth.requireAccountIdentity(authorization);
    return this.reminders.create(userId, emailVerified, body);
  }

  @Delete(':id')
  async cancel(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const { userId } = await this.auth.requireAccountIdentity(authorization);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      throw new BadRequestException('Invalid reminder');
    await this.reminders.cancel(userId, id);
    return { canceled: true };
  }
}
