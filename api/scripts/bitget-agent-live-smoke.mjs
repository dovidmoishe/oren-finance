import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/src/app.module.js');
const {
  AgentToolRegistry,
} = require('../dist/src/agent/tools/agent-tool.registry.js');

const application = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});

try {
  const registry = application.get(AgentToolRegistry);
  const result = await registry.dispatch('getBitgetMarketContext', {
    assetIdOrTicker: process.env.BITGET_SMOKE_TICKER || 'NVDA',
    range: '1D',
  });
  const context = result.output;
  if (!context?.available || !context.quote?.lastPriceUsd) {
    throw new Error(
      `Agent tool returned no live Bitget quote: ${JSON.stringify(context)}`,
    );
  }
  console.log(
    JSON.stringify(
      {
        tool: 'getBitgetMarketContext',
        artifact: result.artifact?.type,
        assetId: context.assetId,
        ticker: context.ticker,
        symbol: context.symbol,
        lastPriceUsd: context.quote.lastPriceUsd,
        change24hPct: context.quote.change24hPct,
        turnover24hUsd: context.quote.turnover24hUsd,
        candleCount: context.candles.length,
        source: context.source,
      },
      null,
      2,
    ),
  );
} finally {
  await application.close();
}
