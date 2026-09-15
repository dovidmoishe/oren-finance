import { Module } from '@nestjs/common';
import { AlchemyModule } from '../alchemy/alchemy.module';
import { TokensModule } from '../tokens/tokens.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioCalendarService } from './portfolio-calendar.service';
import { PortfolioRepository } from './portfolio.repository';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [AlchemyModule, TokensModule],
  controllers: [PortfolioController],
  providers: [PortfolioRepository, PortfolioService, PortfolioCalendarService],
  exports: [PortfolioService, PortfolioRepository, PortfolioCalendarService],
})
export class PortfolioModule {}
