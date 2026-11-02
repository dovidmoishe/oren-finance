import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import tokensClientModule from '../dist/src/tokens/tokens.client.js';
import tokensServiceModule from '../dist/src/tokens/tokens.service.js';

config({
  path:
    process.env.PROOF_ENV_PATH ??
    fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});
const { TokensClient } = tokensClientModule;
const { TokensService } = tokensServiceModule;
const apiKey = process.env.TOKENS_API_KEY;
if (!apiKey) throw new Error('TOKENS_API_KEY is required');
const assetId = process.env.PROOF_ASSET_ID ?? 'TSLA';
const service = new TokensService(
  new TokensClient({
    TOKENS_API_BASE_URL:
      process.env.TOKENS_API_BASE_URL ?? 'https://api.tokens.xyz',
    TOKENS_API_KEY: apiKey,
  }),
);
const stock = await service.getStock(assetId);
console.log(
  JSON.stringify({
    id: stock.id,
    ticker: stock.ticker,
    price: stock.price,
    variants: stock.variants.map((item) => ({
      mint: item.mint,
      symbol: item.symbol,
      tradable: item.tradable,
    })),
  }),
);
