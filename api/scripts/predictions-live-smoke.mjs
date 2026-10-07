import 'dotenv/config';
import { createRequire } from 'node:module';
import OpenAI from 'openai';

const require = createRequire(import.meta.url);
const { validateEnv } = require('../dist/src/config/env.schema.js');
const { PantaService } = require('../dist/src/panta/panta.service.js');
const { TokensClient } = require('../dist/src/tokens/tokens.client.js');
const { TokensService } = require('../dist/src/tokens/tokens.service.js');
const {
  PredictionsService,
} = require('../dist/src/predictions/predictions.service.js');
const {
  PredictionResearchService,
} = require('../dist/src/predictions/prediction-research.service.js');

try {
  if (!process.env.PANTA_API_BASE_URL || !process.env.PANTA_API_KEY) {
    console.log('Panta discovery smoke skipped: API URL/key are absent.');
    process.exit(0);
  }
  const env = validateEnv();
  const tokens = new TokensService(new TokensClient(env));
  // Use the real canonical provider without starting DB/indexing workers.
  let stocks;
  const canonical = {
    async listStocks() {
      stocks ??= await tokens.getStocks();
      return { items: stocks, pagination: { hasMore: false } };
    },
  };
  const provider = new PantaService(env);
  const predictions = new PredictionsService(provider, canonical);
  const page = await predictions.search();
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        eligibleMarkets: page.items.length,
        hasMore: page.hasMore,
        coverage: page.coverage,
      },
      null,
      2,
    ),
  );
  // Empty active coverage is valid. A resolved real event can still verify research.
  let market =
    page.items[0] ?? (await predictions.search({ phase: 'resolved' })).items[0];
  if (!market) {
    const candidate = (
      await provider.listMarkets({ category: 'crypto', limit: 50 })
    ).items[0];
    if (candidate) market = await predictions.detail(candidate.marketId);
  }
  if (market) {
    const detail = await predictions.detail(market.marketId);
    console.log(
      JSON.stringify({
        detailVerified: detail.marketId === market.marketId,
        phase: detail.phase,
        spotAvailable: detail.outcomes.some((s) => s.priceUsdc !== null),
      }),
    );
  }
  if (process.argv.includes('--research')) {
    if (!market)
      throw new Error('No investing market available for live research');
    if (!env.OPENAI_API_KEY) throw new Error('OpenAI credentials unavailable');
    const research = new PredictionResearchService(
      predictions,
      {
        async getEquityNews(id) {
          return { items: await tokens.getNews(id) };
        },
      },
      {
        async getAnalysis() {
          throw new Error('Optional analysis omitted in smoke');
        },
      },
      new OpenAI({ apiKey: env.OPENAI_API_KEY }),
      env,
    );
    const brief = await research.research(market.marketId);
    console.log(
      JSON.stringify(
        {
          researchStatus: brief.status,
          sourceCount: brief.sources.length,
          evidenceCount: brief.supporting.length,
          counterargumentCount: brief.counterarguments.length,
          warnings: brief.warnings,
        },
        null,
        2,
      ),
    );
    if (brief.status !== 'researched') process.exitCode = 1;
  }
  if (process.argv.includes('--serve')) {
    const { Module, ValidationPipe } = require('@nestjs/common');
    const { NestFactory } = require('@nestjs/core');
    const {
      PredictionsController,
    } = require('../dist/src/predictions/predictions.controller.js');
    const {
      HttpExceptionFilter,
    } = require('../dist/src/common/filters/http-exception.filter.js');
    class SmokeModule {}
    Module({
      controllers: [PredictionsController],
      providers: [{ provide: PredictionsService, useValue: predictions }],
    })(SmokeModule);
    const app = await NestFactory.create(SmokeModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({
      origin: ['http://127.0.0.1:3001', 'http://localhost:3001'],
    });
    await app.listen(3100, '127.0.0.1');
    console.log('Read-only discovery verification server ready on port 3100');
  }
} catch (error) {
  console.error(
    error instanceof Error &&
      error.message === 'No investing market available for live research'
      ? 'Live research blocked: no titled investing market is available in active or resolved coverage.'
      : 'Discovery/research smoke failed; verify provider configuration and access. No secrets were printed.',
  );
  process.exitCode = 1;
}
