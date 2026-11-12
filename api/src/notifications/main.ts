import { NestFactory } from '@nestjs/core';
import { NotificationWorkerModule } from './worker.module';

async function main() {
  const app = await NestFactory.createApplicationContext(
    NotificationWorkerModule,
    { abortOnError: false, logger: ['log', 'warn'] },
  );
  app.enableShutdownHooks();
}

void main().catch(() => {
  // Provider errors may embed credentials. Never print raw errors here.
  process.stderr.write('Notification worker failed to initialize\n');
  process.exitCode = 1;
});
