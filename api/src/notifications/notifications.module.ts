import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SenviokModule } from '../senviok/senviok.module';
import { TradeEmailController } from './trade-email.controller';
import { TradeEmailRepository } from './trade-email.repository';
import { TradeEmailWorker } from './trade-email.worker';

@Module({
  imports: [AuthModule, SenviokModule],
  controllers: [TradeEmailController],
  providers: [TradeEmailRepository, TradeEmailWorker],
})
export class NotificationsModule {}
