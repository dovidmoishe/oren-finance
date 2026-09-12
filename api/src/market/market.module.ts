import { Module } from '@nestjs/common';
import { TokensModule } from '../tokens/tokens.module';
import { MarketService } from './market.service';
import { MarketsController } from './markets.controller';
import { StocksController } from './stocks.controller';

@Module({
  imports: [TokensModule],
  controllers: [StocksController, MarketsController],
  providers: [MarketService],
  exports: [MarketService],
})
export class MarketModule {}
