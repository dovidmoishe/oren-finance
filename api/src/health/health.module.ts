import { Module } from '@nestjs/common';
import { AlchemyModule } from '../alchemy/alchemy.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { TokensModule } from '../tokens/tokens.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [TokensModule, AlchemyModule, AnalyticsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
