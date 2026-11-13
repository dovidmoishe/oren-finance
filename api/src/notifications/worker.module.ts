import { Module } from '@nestjs/common';
import { openAiClientProvider } from '../agent/openai.provider';
import { AlchemyModule } from '../alchemy/alchemy.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { NewsModule } from '../news/news.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { TokensModule } from '../tokens/tokens.module';
import { PricePolling } from './alerts';
import { MorningBrief } from './brief';
import { NotificationsModule } from './notifications.module';
import { NotificationWorker } from './worker';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    NotificationsModule,
    AuthModule,
    AlchemyModule,
    NewsModule,
    TokensModule,
    PreferencesModule,
  ],
  providers: [
    openAiClientProvider,
    MorningBrief,
    PricePolling,
    NotificationWorker,
  ],
})
export class NotificationWorkerModule {}
