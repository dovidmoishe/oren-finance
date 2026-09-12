import { Module } from '@nestjs/common';
import { TokensClient } from './tokens.client';
import { TokensMarketDataProvider } from './tokens-market-data.provider';
import { TokensService } from './tokens.service';

@Module({
  providers: [TokensClient, TokensService, TokensMarketDataProvider],
  exports: [TokensService, TokensMarketDataProvider, TokensClient],
})
export class TokensModule {}
