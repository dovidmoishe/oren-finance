import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { openAiClientProvider } from '../agent/openai.provider';
import { NewsFeedController } from './news-feed.controller';
import { NewsFeedService } from './news-feed.service';
import { NewsCurator } from './news-curator.service';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TokensModule } from '../tokens/tokens.module';
import { NewsController } from './news.controller';
import { NewsRepository } from './news.repository';
import { NewsService } from './news.service';
import { EquityNewsService } from './equity-news.service';

@Module({
  imports: [TokensModule, PortfolioModule, AuthModule],
  controllers: [NewsController, NewsFeedController],
  providers: [
    NewsRepository,
    NewsService,
    EquityNewsService,
    NewsFeedService,
    NewsCurator,
    openAiClientProvider,
  ],
  exports: [NewsService, NewsRepository],
})
export class NewsModule {}
