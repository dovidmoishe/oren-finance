const baseUrl = (
  process.env.BITGET_API_BASE_URL || 'https://api.bitget.com'
).replace(/\/$/, '');
const timeoutMs = Number(process.env.BITGET_REQUEST_TIMEOUT_MS || 15000);
const timingsMs = {};

async function get(path, query = {}) {
  const startedAt = performance.now();
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.code !== '00000')
    throw new Error(`${path} returned ${body.code}: ${body.msg}`);
  timingsMs[path] = Math.round(performance.now() - startedAt);
  return body.data;
}

const symbol = 'RNVDAUSDT';
const [stocks, tickers, candles, states] = await Promise.all([
  get('/api/v3/reality/market/stock-info', { symbol }),
  get('/api/v3/market/tickers', { category: 'SPOT', symbol }),
  get('/api/v3/market/candles', {
    category: 'SPOT',
    symbol,
    interval: '5m',
    type: 'market',
    limit: '10',
  }),
  get('/api/v3/reality/market/states'),
]);

const nvda = stocks.find((item) => item.code === 'NVDA');
if (!nvda?.symbol)
  throw new Error('NVDA is not present in the live Bitget Reality directory');

const ticker = tickers[0];
if (!ticker || !Number.isFinite(Number(ticker.lastPrice))) {
  throw new Error(`No valid live ticker returned for ${nvda.symbol}`);
}
if (!Array.isArray(candles) || candles.length === 0) {
  throw new Error(`No live candles returned for ${nvda.symbol}`);
}
const marketStateAvailable = Array.isArray(states) && states.length > 0;

console.log(
  JSON.stringify(
    {
      provider: 'Bitget',
      product: 'Reality',
      symbol: nvda.symbol,
      lastPrice: ticker.lastPrice,
      change24h: ticker.price24hPcnt,
      turnover24h: ticker.turnover24h,
      candleCount: candles.length,
      market: states[0]?.market,
      marketStateAvailable,
      timingsMs,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
