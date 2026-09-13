import { Module } from '@nestjs/common';
import { TokensModule } from '../tokens/tokens.module';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './intelligence.service';
import { SignalsRepository } from './signals.repository';

@Module({
  imports: [TokensModule],
  controllers: [IntelligenceController],
  providers: [SignalsRepository, IntelligenceService],
  exports: [IntelligenceService, SignalsRepository],
})
export class IntelligenceModule {}
