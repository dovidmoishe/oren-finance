import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { TokensModule } from '../tokens/tokens.module';
import { MarketService } from './market.service';
import { LandingMarketService } from './landing-market.service';
import { MarketsController } from './markets.controller';
import { StocksController } from './stocks.controller';

@Module({
  imports: [TokensModule, IntelligenceModule, AuthModule, PreferencesModule],
  controllers: [StocksController, MarketsController],
  providers: [MarketService, LandingMarketService],
  exports: [MarketService],
})
export class MarketModule {}
