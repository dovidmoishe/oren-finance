import { Module } from '@nestjs/common';
import { AlchemyModule } from './alchemy/alchemy.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { ExecutionModule } from './execution/execution.module';
import { HealthModule } from './health/health.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { MarketModule } from './market/market.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { TokensModule } from './tokens/tokens.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
    TokensModule,
    AlchemyModule,
    HealthModule,
    PortfolioModule,
    IntelligenceModule,
    MarketModule,
    ExecutionModule,
  ],
})
export class AppModule {}
