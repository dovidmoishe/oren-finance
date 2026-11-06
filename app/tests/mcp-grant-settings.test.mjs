import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGrantSettings } from '../services/mcp-grant-settings.ts';
import { validateMcpSignerConfig } from '../scripts/validate-mcp-signer-config.mjs';

const draft = { perTradeUsd: '25', dailyUsd: '50', slippagePercent: '0.5', durationHours: '24', allowSell: false };
test('displayed percentage becomes exact basis points in signed terms', () => {
  assert.deepEqual(parseGrantSettings(draft, false), { perTradeUsd: 25, dailyUsd: 50, maxSlippageBps: 50, durationHours: 24, allowSell: false });
  assert.equal(parseGrantSettings({ ...draft, slippagePercent: '0.29' }, false).maxSlippageBps, 29);
  assert.equal(parseGrantSettings({ ...draft, slippagePercent: '0.01' }, false).maxSlippageBps, 1);
});
test('rejects empty, nonfinite, out-of-range and overprecise limits', () => {
  for (const [key, values] of Object.entries({ perTradeUsd: ['', '0', '25.01', '0.001', 'NaN', 'Infinity'], dailyUsd: ['24.99', '50.01'], slippagePercent: ['', '0', '0.51', '0.005'], durationHours: ['', '0', '25', '1.5'] })) {
    for (const value of values) assert.throws(() => parseGrantSettings({ ...draft, [key]: value }, false), `${key}=${value}`);
  }
});
test('selling requires server-advertised availability', () => {
  assert.throws(() => parseGrantSettings({ ...draft, allowSell: true }, false), /not available/);
  assert.equal(parseGrantSettings({ ...draft, allowSell: true }, true).allowSell, true);
});
test('production image builds require both trusted signer pins; previews remain read/review only', () => {
  const env = { NEXT_PUBLIC_DEPLOYMENT_ENV: 'production', NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID: 'quorum', NEXT_PUBLIC_MCP_SIGNER_POLICY_ID: 'policy' };
  validateMcpSignerConfig(env);
  for (const key of ['NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID', 'NEXT_PUBLIC_MCP_SIGNER_POLICY_ID'])
    assert.throws(() => validateMcpSignerConfig({ ...env, [key]: '' }), /Production chat trading requires/);
  validateMcpSignerConfig({ NEXT_PUBLIC_DEPLOYMENT_ENV: 'preview' });
});
