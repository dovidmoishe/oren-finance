import { Module } from '@nestjs/common';
import { ExecutionModule } from '../execution/execution.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { MarketModule } from '../market/market.module';
import { NewsModule } from '../news/news.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { VaultModule } from '../vault/vault.module';
import { AgentController } from './agent.controller';
import { AgentRepository } from './agent.repository';
import { AgentService } from './agent.service';
import { openAiClientProvider } from './openai.provider';
import { AgentToolRegistry } from './tools/agent-tool.registry';

@Module({
  imports: [
    PortfolioModule,
    MarketModule,
    NewsModule,
    IntelligenceModule,
    ExecutionModule,
    VaultModule,
  ],
  controllers: [AgentController],
  providers: [
    openAiClientProvider,
    AgentRepository,
    AgentToolRegistry,
    AgentService,
  ],
  exports: [AgentService, AgentToolRegistry],
})
export class AgentModule {}
