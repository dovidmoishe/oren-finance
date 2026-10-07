import { Module } from '@nestjs/common';
import { PantaModule } from '../panta/panta.module';
import { MarketModule } from '../market/market.module';
import { NewsModule } from '../news/news.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { OpenAiModule } from '../openai/openai.module';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { PredictionResearchService } from './prediction-research.service';

@Module({
  imports: [
    PantaModule,
    MarketModule,
    NewsModule,
    IntelligenceModule,
    OpenAiModule,
  ],
  controllers: [PredictionsController],
  providers: [PredictionsService, PredictionResearchService],
  exports: [PredictionsService, PredictionResearchService],
})
export class PredictionsModule {}
