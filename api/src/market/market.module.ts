import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { TokensModule } from '../tokens/tokens.module';
import { MarketService } from './market.service';
import { LandingMarketService } from './landing-market.service';
import { MarketsController } from './markets.controller';
import { StocksController } from './stocks.controller';
import {
  MarketCalendarController,
  MarketHoursController,
} from './calendar/market-calendar.controller';
import { MarketCalendarService } from './calendar/market-calendar.service';
import { MarketEventsRepository } from './calendar/market-events.repository';
import { MarketEventsWorker } from './calendar/market-events.worker';
import { UsEquityCalendarService } from './calendar/us-equity-calendar.service';

@Module({
  imports: [TokensModule, IntelligenceModule, AuthModule, PreferencesModule],
  controllers: [
    StocksController,
    MarketsController,
    MarketHoursController,
    MarketCalendarController,
  ],
  providers: [
    MarketService,
    LandingMarketService,
    UsEquityCalendarService,
    MarketEventsRepository,
    MarketCalendarService,
    MarketEventsWorker,
  ],
  exports: [
    MarketService,
    UsEquityCalendarService,
    MarketEventsRepository,
    MarketCalendarService,
  ],
})
export class MarketModule {}
