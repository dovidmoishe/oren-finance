import { Module } from '@nestjs/common';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TokensModule } from '../tokens/tokens.module';
import { BasketCache } from './basket-cache';
import { ExecutionController } from './execution.controller';
import { ExecutionRepository } from './execution.repository';
import { ExecutionService } from './execution.service';
import { JupiterClient } from './jupiter/jupiter.client';
import { JupiterService } from './jupiter/jupiter.service';
import { JupiterTriggerClient } from './jupiter/jupiter-trigger.client';
import { LimitOrderCache } from './limit-order-cache';
import { LimitOrderRepository } from './limit-order.repository';
import { QuoteCache } from './quote-cache';
import { VariantSelector } from './variant-selector';

@Module({
  imports: [TokensModule, PortfolioModule, IntelligenceModule],
  controllers: [ExecutionController],
  providers: [
    BasketCache,
    LimitOrderCache,
    JupiterClient,
    JupiterTriggerClient,
    JupiterService,
    QuoteCache,
    VariantSelector,
    ExecutionRepository,
    LimitOrderRepository,
    ExecutionService,
  ],
  exports: [ExecutionService, JupiterService],
})
export class ExecutionModule {}
