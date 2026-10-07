import 'dotenv/config';
import { createRequire } from 'node:module';

// Build first: the smoke deliberately exercises the actual provider + mapper.
if (!process.env.PANTA_API_BASE_URL || !process.env.PANTA_API_KEY) {
  console.log(
    'SKIPPED: configure PANTA_API_BASE_URL and PANTA_API_KEY for the read-only Panta smoke',
  );
} else {
  try {
    const require = createRequire(import.meta.url);
    const { PantaService } = require('../dist/src/panta/panta.service.js');
    const service = new PantaService({
      PANTA_ENABLED: true,
      PANTA_API_BASE_URL: process.env.PANTA_API_BASE_URL.replace(/\/+$/, ''),
      PANTA_API_KEY: process.env.PANTA_API_KEY,
      PANTA_REQUEST_TIMEOUT_MS: Number(
        process.env.PANTA_REQUEST_TIMEOUT_MS || 8000,
      ),
    });
    const categories = await service.getCategories();
    const page = await service.listMarkets({ limit: 1 });
    if (!page.items.length) throw new Error('PANTA_EMPTY_CATALOG');
    const detail = await service.getMarket(page.items[0].marketId);
    console.log(
      JSON.stringify(
        {
          status: 'passed',
          provider: 'Panta',
          categoryCount: categories.categories.length,
          marketId: detail.marketId,
          phase: detail.phase,
          hasSpotPrice: detail.outcomes.some((side) => side.priceUsdc !== null),
          observedAt: detail.source.observedAt,
          stale: detail.source.stale,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    // Never print upstream bodies, keys, URLs or stack traces.
    const safeCodes = new Set([
      'PANTA_EMPTY_CATALOG',
      'PANTA_DISABLED',
      'PANTA_NOT_CONFIGURED',
      'PANTA_UNAUTHORIZED',
      'PANTA_FORBIDDEN',
      'PANTA_NOT_FOUND',
      'PANTA_RATE_LIMITED',
      'PANTA_UNAVAILABLE',
      'PANTA_TIMEOUT',
      'PANTA_INVALID_RESPONSE',
      'PANTA_BAD_REQUEST',
    ]);
    const code = error?.code || error?.message;
    console.error(
      'Panta smoke failed:',
      safeCodes.has(code) ? code : 'BUILD_OR_CONFIGURATION_ERROR',
    );
    process.exitCode = 1;
  }
}
