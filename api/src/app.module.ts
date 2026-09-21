import { Module } from '@nestjs/common';
import { AlchemyModule } from './alchemy/alchemy.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AgentModule } from './agent/agent.module';
import { BitgetModule } from './bitget/bitget.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { ExecutionModule } from './execution/execution.module';
import { HealthModule } from './health/health.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { MarketModule } from './market/market.module';
import { NewsModule } from './news/news.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { SocialModule } from './social/social.module';
import { TokensModule } from './tokens/tokens.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
    BitgetModule,
    TokensModule,
    AlchemyModule,
    AnalyticsModule,
    HealthModule,
    PortfolioModule,
    IntelligenceModule,
    MarketModule,
    NewsModule,
    ExecutionModule,
    SocialModule,
    AgentModule,
    VaultModule,
  ],
})
export class AppModule {}
