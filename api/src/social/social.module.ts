import { Module } from '@nestjs/common';
import { ExecutionModule } from '../execution/execution.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { SocialController } from './social.controller';
import { SocialRepository } from './social.repository';
import { SocialService } from './social.service';

@Module({
  imports: [PortfolioModule, ExecutionModule],
  controllers: [SocialController],
  providers: [SocialRepository, SocialService],
  exports: [SocialService],
})
export class SocialModule {}
