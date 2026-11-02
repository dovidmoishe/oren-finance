import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { DripService } from './drip.service';

@Module({
  imports: [MarketModule],
  providers: [DripService],
  exports: [DripService],
})
export class DripModule {}
