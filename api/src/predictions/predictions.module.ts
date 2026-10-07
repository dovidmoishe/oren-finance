import { Module } from '@nestjs/common';
import { PantaModule } from '../panta/panta.module';
import { MarketModule } from '../market/market.module';
import { NewsModule } from '../news/news.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { OpenAiModule } from '../openai/openai.module';
import { CreationController } from './creation/creation.controller';
import { CreationSessionService } from './creation/creation-session.service';
import { CreationRepository } from './creation/creation.repository';
import { CreationResearchService } from './creation/creation-research.service';
import { CreationArtworkService } from './creation/creation-artwork.service';
import { CreationProvider } from './creation/creation.provider';
import { CreationTransactionService } from './creation/creation-transaction.service';
import { PredictionCreationService } from './creation/creation.service';
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
  controllers: [PredictionsController, CreationController],
  providers: [
    PredictionsService,
    PredictionResearchService,
    CreationSessionService,
    CreationRepository,
    CreationResearchService,
    CreationArtworkService,
    CreationProvider,
    CreationTransactionService,
    PredictionCreationService,
  ],
  exports: [
    PredictionsService,
    PredictionResearchService,
    PredictionCreationService,
    CreationSessionService,
  ],
})
export class PredictionsModule {}
