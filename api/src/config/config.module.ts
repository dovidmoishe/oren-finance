import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_ENV } from './constants';
import { validateEnv, type AppEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: () => validateEnv(),
    }),
  ],
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): AppEnv => validateEnv(),
    },
  ],
  exports: [NestConfigModule, APP_ENV],
})
export class ConfigModule {}
