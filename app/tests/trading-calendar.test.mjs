import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const originalTz = process.env.TZ;
const ui = compile('../components/ui/utils.ts', { Date, Intl });

function compile(file, context) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, ...context });
  return exports;
}

function clockDate(iso) {
  const RealDate = Date;
  return class ClockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(iso);
      else super(...args);
    }

    static now() {
      return new RealDate(iso).getTime();
    }
  };
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node);
  walk(node.props?.children, visit);
}

function screen({ timeZone, now, calendar }) {
  process.env.TZ = timeZone;
  const calls = [];
  const dayCalls = [];
  const pressed = [];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const portfolio = {
    calendar,
    calendarDay: undefined,
    isCalendarLoading: false,
    error: undefined,
    loadCalendar: (...args) => { calls.push(copy(args)); },
    loadCalendarDay: (...args) => { dayCalls.push(copy(args)); },
    reset() {},
  };
  const wallet = { address: 'wallet', connected: true };
  const slots = [];
  const effects = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useMemo(fn) { return fn(); },
    useEffect(effect) { effects.push(effect); },
  };
  const shell = ({ children }) => createElement('div', null, children);
  const compiled = compile('../components/calendar/trading-calendar.tsx', {
    Date: clockDate(now),
    Intl,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (name === '@/components/auth/auth-context') return { useOrenAuth: () => ({ authenticated: true, ready: true }) };
      if (name === '@/components/auth/restore-actions') return { RestoreActions: () => null, restoreBlocked: () => false };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/store') return {
        usePortfolioStore: (select) => select(portfolio),
        useWalletStore: (select) => select(wallet),
      };
      if (name === '@hugeicons/core-free-icons') return {};
      if (name === '@hugeicons/react') return { HugeiconsIcon: () => null };
      if (name === '@/components/ui') return {
        ...ui,
        Button: ({ children, ...props }) => {
          pressed.push(props);
          return createElement('button', props, children);
        },
        Card: shell,
        CardContent: shell,
        CardHeader: shell,
        EmptyState: () => null,
        ErrorState: () => null,
        Skeleton: () => null,
      };
      return require(name);
    },
  });

  function render() {
    cursor = 0;
    effects.length = 0;
    pressed.length = 0;
    const element = compiled.TradingCalendar();
    effects.slice().forEach((effect) => effect());
    return element;
  }

  function buttons(element) {
    const found = [];
    walk(element, (node) => { if (node.type === 'button') found.push(node); });
    return found;
  }

  return {
    calls,
    dayCalls,
    html: () => renderToStaticMarkup(render()),
    press(label) {
      renderToStaticMarkup(render());
      const button = pressed.find((props) => props['aria-label'] === label);
      if (!button) throw new Error(`missing ${label}`);
      button.onClick();
    },
    selectDay() {
      const element = render();
      buttons(element).find((node) => node.props.type === 'button').props.onClick();
    },
  };
}

const novemberDay = {
  date: '2026-11-01',
  hasData: false,
  pnlUsd: 0,
  returnPct: 0,
  openingValueUsd: 0,
  closingValueUsd: 0,
  realizedActivityUsd: 0,
  unrealizedMovementUsd: 0,
  availableValueUsd: 0,
  lockedValueUsd: 0,
  cumulativeValueUsd: 0,
  eventCount: 0,
  significantEvents: [],
};

describe('trading calendar labels', { concurrency: false }, () => {
  test.after(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test('names the open month and selected day in the viewer timezone', () => {
    const view = screen({
      timeZone: 'America/New_York',
      now: '2026-11-15T17:00:00.000Z',
      calendar: { days: [novemberDay], notes: [] },
    });

    assert.deepEqual(view.calls, []);
    const html = view.html();
    assert.equal(view.calls[0][0], 'wallet');
    assert.deepEqual(view.calls[0][1], { month: '2026-11', timeZone: 'America/New_York' });
    assert.equal(html.match(/November 2026/g)?.length, 2);
    assert.equal(html.includes('October 2026'), false);

    view.selectDay();
    const day = view.html();
    assert.match(day, /Nov 1, 2026/);
    assert.equal(day.includes('Oct 31, 2026'), false);
    assert.deepEqual(view.dayCalls.at(-1), ['wallet', '2026-11-01', { timeZone: 'America/New_York' }]);
  });

  test('opens the local month when UTC has already crossed the boundary', () => {
    const view = screen({ timeZone: 'America/New_York', now: '2026-11-01T03:00:00.000Z' });
    const html = view.html();
    assert.deepEqual(view.calls[0][1], { month: '2026-10', timeZone: 'America/New_York' });
    assert.match(html, /October 2026/);
    assert.equal(html.includes('November 2026'), false);
  });

  test('opens the local month when the viewer is already in the next month', () => {
    const view = screen({ timeZone: 'Asia/Tokyo', now: '2026-10-31T16:00:00.000Z' });
    const html = view.html();
    assert.deepEqual(view.calls[0][1], { month: '2026-11', timeZone: 'Asia/Tokyo' });
    assert.match(html, /November 2026/);
    assert.equal(html.includes('October 2026'), false);
  });

  test('month controls keep the heading on the month they request', () => {
    const view = screen({ timeZone: 'America/New_York', now: '2026-11-15T17:00:00.000Z' });
    view.html();
    view.press('Next month');
    const december = view.html();
    assert.deepEqual(view.calls.at(-1)[1], { month: '2026-12', timeZone: 'America/New_York' });
    assert.match(december, /December 2026/);
    assert.equal(december.includes('November 2026'), false);

    view.press('Previous month');
    view.press('Previous month');
    const october = view.html();
    assert.deepEqual(view.calls.at(-1)[1], { month: '2026-10', timeZone: 'America/New_York' });
    assert.match(october, /October 2026/);
  });

  test('keeps UTC calendar labels on the requested civil month and day', () => {
    const view = screen({
      timeZone: 'UTC',
      now: '2026-11-15T17:00:00.000Z',
      calendar: { days: [novemberDay], notes: [] },
    });
    const html = view.html();
    assert.deepEqual(view.calls[0][1], { month: '2026-11', timeZone: 'UTC' });
    assert.match(html, /November 2026/);
    view.selectDay();
    assert.match(view.html(), /Nov 1, 2026/);
  });
});
