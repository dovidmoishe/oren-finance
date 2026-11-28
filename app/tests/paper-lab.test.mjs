import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function loadLib(env = { NEXT_PUBLIC_DEPLOYMENT_ENV: 'preview', NEXT_PUBLIC_PREVIEW_PR_NUMBER: '142' }) {
  const exports = {};
  vm.runInNewContext(transpile('../lib/paper-lab.ts'), { exports, Intl, process: { env } });
  return exports;
}

function loadView() {
  const exports = {};
  const lib = loadLib();
  vm.runInNewContext(transpile('../components/paper/paper-lab.tsx'), {
    exports,
    Intl,
    require(id) {
      if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (id === '@/lib/paper-lab') return lib;
      if (id === '@/i18n/i18n') return { useI18n: () => ({ locale: 'en' }) };
      if (id === '@/services/api-client') return { ApiError: class extends Error {}, apiRequest: () => Promise.resolve({}) };
      if (id === '@/components/ui') return {
        Button: ({ children, onClick, disabled }) => createElement('button', { onClick, disabled }, children),
        EmptyState: ({ title, description }) => createElement('div', { role: 'status' }, title, ' ', description),
        ErrorState: ({ title }) => createElement('div', { role: 'alert' }, title),
        LoadingState: ({ label }) => createElement('div', {}, label),
        cn: (...values) => values.filter(Boolean).join(' '),
        formatDateTime: (value, _locale, _zone, missing) => (value ? new Date(value).toISOString() : missing),
      };
      return require(id);
    },
  });
  return exports;
}

const quote = (input, minimumOutput) => ({ inputMint: 'in', outputMint: 'out', input, quotedOutput: minimumOutput, minimumOutput });
const report = {
  experiment: 'five-ai-v1',
  status: 'observing',
  startedAt: '2026-11-24T23:01:51.812Z',
  endsAt: '2026-12-04T23:01:51.812Z',
  deployedCommit: '4f81eee0000000000000000000000000000000',
  lastPollAt: '2026-11-26T13:00:00.000Z',
  pollError: null,
  startingUsdcPerAccount: 10000,
  totalStartingUsdc: 20000,
  cadence: { reviewHours: 1, marketScreenHours: 4, durationHours: 240 },
  coverage: [{ epoch: 36, at: '2026-11-26T11:02:00.000Z', count: 403 }],
  assets: {
    nvidia: { ticker: 'NVDA', name: 'NVIDIA', logo: 'https://example.com/nvda.png' },
    amd: { ticker: 'AMD', name: 'Advanced Micro Devices', logo: null },
  },
  accounts: [
    {
      accountId: 'trader-1',
      startedAt: '2026-11-24T23:01:51.812Z',
      endsAt: '2026-12-04T23:01:51.812Z',
      nextCheckAt: '2026-11-26T14:01:51.812Z',
      status: 'observing',
      book: { cash: '8999990000', positions: { nvidia: { mint: 'NVDAx', quantity: '993010000' } } },
      lastError: null,
      netPnlUsdc: -1,
      returnPct: -0.01,
      observedDrawdownPct: 0.01,
      rounds: [
        {
          epoch: 29,
          at: '2026-11-26T04:02:00.000Z',
          method: 'hourly-swing-v2',
          candidates: ['nvidia'],
          observations: [{ asset: 'nvidia', source: 'stock', session: 'closed', marketClosed: true, signal: 'hold' }],
          equityRaw: '10000000000',
        },
        {
          epoch: 30,
          at: '2026-11-26T05:02:00.000Z',
          method: 'hourly-swing-v2',
          candidates: ['nvidia', 'stock-ivnsacjc'],
          observations: [
            { asset: 'nvidia', source: 'stock', session: 'closed', marketClosed: true, signal: 'hold' },
            { asset: 'stock-ivnsacjc', source: 'token', error: 'insufficient_recent_daily_bars', signal: 'hold' },
          ],
          equityRaw: '10000000000',
        },
        {
          epoch: 31,
          at: '2026-11-26T15:02:00.000Z',
          method: 'hourly-swing-v2',
          candidates: ['nvidia'],
          observations: [
            {
              asset: 'nvidia',
              source: 'stock',
              session: 'regular',
              signal: 'buy',
              filled: true,
              terms: quote('1000000000', '995000000'),
              mark: '999000000',
              research: { tools: ['inspectSignals', 'inspectBars'], model: 'gpt-test', selected: 'breakout-v1', rationale: 'Hourly close cleared the 20-bar high with the daily trend intact.' },
            },
          ],
          equityRaw: '9999000000',
        },
      ],
    },
    {
      accountId: 'trader-2',
      startedAt: '2026-11-24T23:01:51.812Z',
      endsAt: '2026-12-04T23:01:51.812Z',
      nextCheckAt: '2026-11-26T14:01:51.812Z',
      status: 'observing',
      book: { cash: '9940000000', positions: {} },
      lastError: 'market_round_unavailable',
      netPnlUsdc: -60,
      returnPct: -0.6,
      observedDrawdownPct: 0.6,
      rounds: [
        {
          epoch: 31,
          at: '2026-11-28T15:30:00.000Z',
          method: 'hourly-swing-v2',
          candidates: [],
          observations: [
            { asset: 'amd', source: 'stock', session: 'closed', marketClosed: true, signal: 'sell', guardExit: 'stop', filled: true, terms: quote('5000000', '950000000') },
          ],
          equityRaw: '9940000000',
        },
      ],
    },
  ],
};

test('the page exists only in the PR 142 preview', () => {
  assert.equal(loadLib().paperLabEnabled(), true);
  assert.equal(loadLib({ NEXT_PUBLIC_DEPLOYMENT_ENV: 'preview', NEXT_PUBLIC_PREVIEW_PR_NUMBER: '150' }).paperLabEnabled(), false);
  assert.equal(loadLib({ NEXT_PUBLIC_DEPLOYMENT_ENV: 'production', NEXT_PUBLIC_PREVIEW_PR_NUMBER: '142' }).paperLabEnabled(), false);
});

test('summaries total the latest marks and list fills newest first', () => {
  const lib = loadLib();
  assert.equal(lib.usdc('1234567'), 1.234567);
  assert.equal(lib.usdc(null), null);
  const total = lib.combinedValue(report);
  assert.equal(total.value, 19939);
  assert.equal(total.change, -61);
  const fills = lib.paperFills(report.accounts);
  // The module runs in its own realm, so compare plain JSON rather than array prototypes.
  assert.equal(JSON.stringify(fills.map((f) => [f.accountId, f.side, f.usdc])), JSON.stringify([['trader-2', 'sell', 950], ['trader-1', 'buy', 1000]]));
  const unpriced = { ...report, accounts: [{ ...report.accounts[0], rounds: [{ ...report.accounts[0].rounds[0], equityRaw: null }] }] };
  assert.equal(lib.combinedValue(unpriced).value, null);
  assert.equal(lib.combinedValue(unpriced).unknownAccounts, 1);
});

test('v2 accounts are named, and the rules baseline is counted apart from the AI agents', () => {
  const v2 = {
    ...report,
    experiment: 'five-ai-v2',
    accounts: [
      { ...report.accounts[0], accountId: 'v2-rules', policy: 'rules' },
      { ...report.accounts[1], accountId: 'v2-trader-2', policy: 'ai' },
    ],
  };
  const html = render({ report: v2, selectedId: 'v2-rules' });
  assert.ok(html.includes('1 AI agent and 1 rules baseline trading test USDC'));
  assert.ok(html.includes('Rules baseline journal'));
  assert.ok(html.includes('Trader 2'));
});

test('each review outcome gets a plain label', () => {
  const { observationOutcome, isQuietRound } = loadLib();
  assert.equal(observationOutcome({ asset: 'a', marketClosed: true }).label, 'US market closed');
  assert.equal(observationOutcome({ asset: 'a', error: 'insufficient_recent_hourly_bars' }).label, 'Missing recent hourly candles');
  assert.equal(observationOutcome({ asset: 'a', filled: true, signal: 'sell', guardExit: 'stop' }).label, 'Sold · stop hit');
  assert.equal(observationOutcome({ asset: 'a', research: { selected: 'cash' } }).label, 'Chose cash');
  assert.equal(observationOutcome({ asset: 'a', research: { selected: 'cash', error: 'rule_not_signalling' } }).label, 'Chose cash');
  assert.equal(observationOutcome({ asset: 'a', research: { selected: 'cash', error: 'research_unavailable' } }).label, 'Research unavailable');
  assert.equal(observationOutcome({ asset: 'a', error: 'spread_too_wide' }).label, 'Spread too wide to enter');
  assert.equal(isQuietRound(report.accounts[0].rounds[0]), true);
  assert.equal(isQuietRound(report.accounts[0].rounds[1]), false);
});

function render(props = {}) {
  const { PaperLabView } = loadView();
  return renderToStaticMarkup(
    createElement(PaperLabView, {
      report,
      locale: 'en',
      timeZone: 'Africa/Lagos',
      selectedId: null,
      onSelect() {},
      hideQuiet: false,
      onHideQuietChange() {},
      limit: 48,
      onShowMore() {},
      updatedAt: Date.parse('2026-11-26T13:05:00.000Z'),
      refreshing: false,
      onRefresh() {},
      ...props,
    }),
  );
}

test('the view shows balances, logos and the selected journal with model rationale', () => {
  const html = render();
  assert.ok(html.includes('Paper traders'));
  assert.ok(html.includes('19,939.00 USDC'));
  assert.ok(html.includes('−61.00 USDC'));
  assert.ok(html.includes('Trader 1') && html.includes('Trader 2'));
  assert.ok(html.includes('src="https://example.com/nvda.png"'));
  assert.ok(html.includes('Hourly close cleared the 20-bar high'));
  assert.ok(html.includes('Spent 1,000.00 USDC'));
  assert.ok(html.includes('US market closed'));
  assert.ok(html.includes('Missing recent daily candles'));
  assert.ok(html.includes('Stock data') && html.includes('Token data'));
  assert.ok(html.includes('1 buys · 1 sells'));
  assert.ok(html.includes('Showing 3 of 3 reviews'));
});

test('another agent can be selected and quiet reviews can be hidden', () => {
  const second = render({ selectedId: 'trader-2' });
  assert.ok(second.includes('Trader 2 journal'));
  assert.ok(second.includes('Sold · stop hit'));
  assert.ok(second.includes('Sale quoted at 950.00 USDC'));
  const filtered = render({ hideQuiet: true });
  assert.ok(filtered.includes('Showing 2 of 2 reviews (1 quiet reviews hidden)'));
});
