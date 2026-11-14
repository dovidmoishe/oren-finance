import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreferencesReader } from './preferences-reader';
import { PreferencesController } from './preferences.controller';

@Module({
  imports: [AuthModule],
  controllers: [PreferencesController],
  providers: [PreferencesReader],
  exports: [PreferencesReader],
})
export class PreferencesModule {}
