import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreferencesController } from './preferences.controller';

@Module({
  imports: [AuthModule],
  controllers: [PreferencesController],
})
export class PreferencesModule {}
