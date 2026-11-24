import { Module } from '@nestjs/common';
import { TokensModule } from '../tokens/tokens.module';
import { JupiterClient } from '../execution/jupiter/jupiter.client';
import { JupiterClientModule } from '../execution/jupiter/jupiter-client.module';
import { PAPER_QUOTES, type PaperQuotes } from './quotes';
import { AuthModule } from '../auth/auth.module';
import { PaperController } from './paper.controller';
import { PaperService } from './paper.service';
import { MarketModule } from '../market/market.module';
import { MarketBenchmark } from './market-benchmark';
import { openAiClientProvider } from '../agent/openai.provider';
import { PaperResearchAgent } from './paper-research';
import { PaperWorker } from './paper.worker';
import {
  PreviewBenchmark,
  PreviewBenchmarkController,
} from './preview-benchmark';

@Module({
  imports: [TokensModule, JupiterClientModule, AuthModule, MarketModule],
  controllers: [PaperController, PreviewBenchmarkController],
  providers: [
    MarketBenchmark,
    openAiClientProvider,
    PaperResearchAgent,
    PaperService,
    PaperWorker,
    PreviewBenchmark,
    {
      provide: PAPER_QUOTES,
      inject: [JupiterClient],
      useFactory: (client: JupiterClient): PaperQuotes => ({
        getQuote: (params) => client.getQuote(params),
      }),
    },
  ],
})
export class PaperModule {}
