import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Query,
} from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { NewsFeedService } from './news-feed.service';

@Controller('news')
export class NewsFeedController {
  constructor(
    private readonly feed: NewsFeedService,
    private readonly auth: PrivyWalletAuth,
  ) {}

  @Get('trending')
  @Header('Cache-Control', 'public, max-age=30')
  trending() {
    return this.feed.getTrending();
  }

  @Get('for-you')
  @Header('Cache-Control', 'private, no-store')
  async forYou(
    @Query('walletAddress') wallet: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (typeof wallet !== 'string' || !wallet.trim() || wallet.length > 64)
      throw new BadRequestException('walletAddress is required');
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      wallet.trim(),
    );
    return this.feed.getForYou(identity.userId, identity.walletAddress);
  }
}
