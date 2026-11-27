import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SenviokModule } from '../senviok/senviok.module';
import { TokensModule } from '../tokens/tokens.module';
import { PriceAlerts } from './alerts';
import { PriceAlertsController } from './alerts.controller';
import { NotificationDelivery } from './delivery';
import { NotificationJobs } from './jobs';
import { ReleaseReminders } from './reminders';
import { ReleaseRemindersController } from './reminders.controller';
import { NotificationUnsubscribeController } from './unsubscribe.controller';

@Module({
  imports: [AuthModule, SenviokModule, TokensModule],
  controllers: [
    PriceAlertsController,
    ReleaseRemindersController,
    NotificationUnsubscribeController,
  ],
  providers: [
    NotificationJobs,
    PriceAlerts,
    ReleaseReminders,
    NotificationDelivery,
  ],
  exports: [NotificationJobs, NotificationDelivery],
})
export class NotificationsModule {}
