import type {
  CompanyCitation,
  CompanyFiling,
  CompanyMetric,
  CompanyMetricReason,
  CompanyPeriod,
  CompanyResearchData,
} from '../../../types/company-research';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const ACCESSION = ACCESSION_PATTERN;
const FORMS = new Set([
  '10-K',
  '10-Q',
  '10-K/A',
  '10-Q/A',
  '8-K',
  '8-K/A',
  '20-F',
  '40-F',
  '6-K',
]);

export const GAAP_ALIASES = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ],
  netIncome: ['NetIncomeLoss'],
  operatingIncome: ['OperatingIncomeLoss'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
} as const;

export const GAAP_CONCEPTS = new Set<string>(
  Object.values(GAAP_ALIASES).flat(),
);

export interface NormalizedFactInput {
  concept: string;
  unit: string;
  start?: string;
  end: string;
  val: number;
  accn: string;
  form?: string;
  filed: string;
}

type Span = 'instant' | 'quarter' | 'ytd' | 'year' | 'irregular';
type Quarter = 1 | 2 | 3 | 4;

interface Point {
  concept: string;
  unit: string;
  start?: string;
  end: string;
  val: number;
  accn: string;
  form: string;
  filed: string;
  sourceUrl: string;
  span: Span;
  fiscalYear: number;
  fiscalQuarter: Quarter;
  restated: boolean;
  priorValue?: number;
  priorAccession?: string;
  priorFiled?: string;
  derived?: boolean;
  formula?: string;
  inputs?: Point[];
}

type Series =
  | { kind: 'points'; points: Point[]; unit: string }
  | { kind: 'mixed' }
  | { kind: 'empty' };

export function filingIndexUrl(
  cik: string,
  accession: string,
): string | undefined {
  if (!/^\d{10}$/.test(cik) || !ACCESSION.test(accession)) return undefined;
  const folder = accession.replaceAll('-', '');
  if (!/^\d{18}$/.test(folder)) return undefined;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${folder}/${accession}-index.html`;
}

export function fiscalPosition(
  end: string,
  fiscalYearEndMonth: number,
): { fiscalYear: number; fiscalQuarter: Quarter } {
  const month = Number(end.slice(5, 7));
  const year = Number(end.slice(0, 4));
  const startMonth = (fiscalYearEndMonth % 12) + 1;
  const offset = (month - startMonth + 12) % 12;
  const fiscalQuarter = (Math.floor(offset / 3) + 1) as Quarter;
  const fiscalYear = month > fiscalYearEndMonth ? year + 1 : year;
  return { fiscalYear, fiscalQuarter };
}

export function normalizeFinancials(input: {
  name: string;
  ticker: string;
  cik: string;
  fiscalYearEndMonth: number;
  asOf: string;
  facts: NormalizedFactInput[];
  filings: CompanyFiling[];
  filingsNote?: string;
}): {
  publishedAt?: string;
  filingCadence: 'current' | 'stale';
  data: Omit<CompanyResearchData, 'coverage' | 'identity' | 'detail'>;
} {
  const asOf = input.asOf.slice(0, 10);
  const revenue = seriesFor(
    input.facts,
    GAAP_ALIASES.revenue,
    'money',
    asOf,
    input.fiscalYearEndMonth,
    input.cik,
  );
  const netIncome = seriesFor(
    input.facts,
    GAAP_ALIASES.netIncome,
    'money',
    asOf,
    input.fiscalYearEndMonth,
    input.cik,
  );
  const operatingIncome = seriesFor(
    input.facts,
    GAAP_ALIASES.operatingIncome,
    'money',
    asOf,
    input.fiscalYearEndMonth,
    input.cik,
  );
  const flow = indexFlow(pointsOf(revenue));
  const derived = deriveQ4(flow, conceptOf(revenue), unitOf(revenue));
  const incomeFlow = indexFlow(pointsOf(netIncome));
  const incomeDerived = deriveQ4(
    incomeFlow,
    conceptOf(netIncome),
    unitOf(netIncome),
  );
  const operatingFlow = indexFlow(pointsOf(operatingIncome));
  const operatingDerived = deriveQ4(
    operatingFlow,
    conceptOf(operatingIncome),
    unitOf(operatingIncome),
  );
  const quarter = latestQuarter(flow, derived);
  const year = latestYear(flow.years);
  const priorYear = year && yearPoint(flow.years, year.fiscalYear - 1);
  const sameQuarterPrior = quarter
    ? quarterPoint(
        flow.quarters,
        derived,
        quarter.fiscalYear - 1,
        quarter.fiscalQuarter,
      )
    : undefined;
  const incomeQuarter = quarter
    ? quarterPoint(
        incomeFlow.quarters,
        incomeDerived,
        quarter.fiscalYear,
        quarter.fiscalQuarter,
      )
    : undefined;
  const incomeYear = year
    ? yearPoint(incomeFlow.years, year.fiscalYear)
    : undefined;
  const operatingQuarter = quarter
    ? quarterPoint(
        operatingFlow.quarters,
        operatingDerived,
        quarter.fiscalYear,
        quarter.fiscalQuarter,
      )
    : undefined;

  const latestQuarterPeriod = quarter
    ? periodFrom(quarter, {
        revenue: metricFrom(revenue, quarter),
        netIncome: metricFrom(netIncome, aligned(incomeQuarter, quarter)),
        operatingMargin: margin(operatingQuarter, quarter),
      })
    : undefined;
  const latestAnnualPeriod = year
    ? periodFrom(year, {
        revenue: metricFrom(revenue, year),
        netIncome: metricFrom(netIncome, aligned(incomeYear, year)),
        revenueGrowth: growth(year, priorYear),
      })
    : undefined;
  const alignedIncome = quarter ? aligned(incomeQuarter, quarter) : undefined;
  const ttm = {
    revenue:
      revenue.kind === 'mixed'
        ? unavailable('mixed_currency')
        : trailing(flow.quarters, derived, quarter),
    netIncome: trailing(incomeFlow.quarters, incomeDerived, alignedIncome),
  };
  const growthMetrics = {
    quarterlyRevenue: growth(quarter, sameQuarterPrior),
    annualRevenue: growth(year, priorYear),
  };
  const position = {
    cash: instantMetric(
      seriesFor(
        input.facts,
        GAAP_ALIASES.cash,
        'money',
        asOf,
        input.fiscalYearEndMonth,
        input.cik,
      ),
    ),
    assets: instantMetric(
      seriesFor(
        input.facts,
        GAAP_ALIASES.assets,
        'money',
        asOf,
        input.fiscalYearEndMonth,
        input.cik,
      ),
    ),
    liabilities: instantMetric(
      seriesFor(
        input.facts,
        GAAP_ALIASES.liabilities,
        'money',
        asOf,
        input.fiscalYearEndMonth,
        input.cik,
      ),
    ),
  };
  const filingCadence = cadence(input.filings, asOf);
  const links = collectLinks(
    [
      latestQuarterPeriod?.revenue,
      latestQuarterPeriod?.netIncome,
      latestAnnualPeriod?.revenue,
      latestAnnualPeriod?.netIncome,
      ttm.revenue,
      ttm.netIncome,
      growthMetrics.quarterlyRevenue,
      growthMetrics.annualRevenue,
      position.cash,
      position.assets,
      position.liabilities,
    ],
    input.filings,
  );
  const briefing = briefingLines({
    name: safeLabel(input.name),
    ticker: input.ticker,
    cik: input.cik,
    quarter: latestQuarterPeriod,
    annual: latestAnnualPeriod,
    ttm: ttm.revenue,
    quarterlyRevenue:
      revenue.kind === 'mixed'
        ? unavailable('mixed_currency')
        : latestQuarterPeriod?.revenue,
    quarterlyGrowth: growthMetrics.quarterlyRevenue,
    annualGrowth: growthMetrics.annualRevenue,
    margin: latestQuarterPeriod?.operatingMargin,
    cadence: filingCadence,
    filingsNote: input.filingsNote,
  });
  const publishedAt = latestDate([
    quarter?.filed,
    year?.filed,
    ...input.filings.map((filing) => filing.filed),
  ]);
  return {
    publishedAt,
    filingCadence,
    data: {
      latestQuarter: latestQuarterPeriod,
      latestAnnual: latestAnnualPeriod,
      ttm,
      growth: growthMetrics,
      position,
      filings: input.filings,
      links,
      briefing,
      filingCadence,
      filingsNote: input.filingsNote,
    },
  };
}

function aligned(point: Point | undefined, expected: Point): Point | undefined {
  if (!point) return undefined;
  if (point.start !== expected.start || point.end !== expected.end)
    return undefined;
  return point;
}

function periodFrom(
  point: Point,
  metrics: {
    revenue: CompanyMetric;
    netIncome: CompanyMetric;
    operatingMargin?: CompanyMetric;
    revenueGrowth?: CompanyMetric;
  },
): CompanyPeriod {
  return {
    fiscalYear: point.fiscalYear,
    fiscalQuarter: point.span === 'quarter' ? point.fiscalQuarter : undefined,
    start: point.start ?? point.end,
    end: point.end,
    derived: point.derived,
    ...metrics,
  };
}

function seriesFor(
  facts: NormalizedFactInput[],
  aliases: readonly string[],
  kind: 'money',
  asOf: string,
  fiscalYearEndMonth: number,
  cik: string,
): Series {
  for (const concept of aliases) {
    const rows = facts.filter(
      (fact) => fact.concept === concept && usable(fact, asOf, cik),
    );
    if (!rows.length) continue;
    const chosen = chooseUnit(
      rows.map((row) => row.unit),
      kind,
    );
    if (chosen === 'mixed') return { kind: 'mixed' };
    if (!chosen) continue;
    return {
      kind: 'points',
      unit: chosen,
      points: collapse(
        rows.filter((row) => row.unit === chosen),
        fiscalYearEndMonth,
        concept,
        chosen,
        cik,
      ),
    };
  }
  return { kind: 'empty' };
}

function usable(fact: NormalizedFactInput, asOf: string, cik: string): boolean {
  if (!DATE.test(fact.end) || !DATE.test(fact.filed) || fact.filed > asOf) {
    return false;
  }
  if (fact.start !== undefined && !DATE.test(fact.start)) return false;
  if (!ACCESSION.test(fact.accn) || !filingIndexUrl(cik, fact.accn))
    return false;
  return typeof fact.val === 'number' && Number.isSafeInteger(fact.val);
}

function chooseUnit(units: string[], kind: 'money'): string | undefined {
  const distinct = [...new Set(units)];
  if (kind === 'money') {
    const money = distinct.filter((unit) => /^[A-Z]{3}$/.test(unit));
    if (money.includes('USD')) return 'USD';
    if (money.length === 1) return money[0];
    if (money.length > 1) return 'mixed';
  }
  return undefined;
}

function collapse(
  rows: NormalizedFactInput[],
  fiscalYearEndMonth: number,
  concept: string,
  unit: string,
  cik: string,
): Point[] {
  const groups = new Map<string, NormalizedFactInput[]>();
  for (const row of rows) {
    const key = `${row.start ?? ''}|${row.end}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const points: Point[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn),
    );
    const current = sorted[0];
    const prior = sorted.find((row) => row.val !== current.val);
    const span = classify(current.start, current.end);
    const fiscal = fiscalPosition(current.end, fiscalYearEndMonth);
    points.push({
      concept,
      unit,
      start: current.start,
      end: current.end,
      val: current.val,
      accn: current.accn,
      form: cleanForm(current.form),
      filed: current.filed,
      sourceUrl: filingIndexUrl(cik, current.accn) ?? '',
      span,
      fiscalYear: fiscal.fiscalYear,
      fiscalQuarter: fiscal.fiscalQuarter,
      restated: Boolean(prior),
      priorValue: prior?.val,
      priorAccession: prior?.accn,
      priorFiled: prior?.filed,
    });
  }
  return points;
}

function classify(start: string | undefined, end: string): Span {
  if (!start) return 'instant';
  const from = dayNumber(start);
  const to = dayNumber(end);
  if (from === undefined || to === undefined || to < from) return 'irregular';
  const days = to - from;
  if (days >= 80 && days <= 100) return 'quarter';
  if (days >= 350 && days <= 380) return 'year';
  if (days >= 101 && days <= 349) return 'ytd';
  return 'irregular';
}

function indexFlow(points: Point[]): {
  quarters: Map<string, Point | 'conflict'>;
  years: Map<number, Point | 'conflict'>;
} {
  const quarters = new Map<string, Point | 'conflict'>();
  const years = new Map<number, Point | 'conflict'>();
  for (const point of points) {
    if (point.span === 'quarter') {
      const key = quarterKey(point.fiscalYear, point.fiscalQuarter);
      const existing = quarters.get(key);
      quarters.set(
        key,
        !existing
          ? point
          : existing === 'conflict' ||
              existing.start !== point.start ||
              existing.end !== point.end
            ? 'conflict'
            : existing,
      );
    }
    if (point.span === 'year') {
      const existing = years.get(point.fiscalYear);
      years.set(
        point.fiscalYear,
        !existing
          ? point
          : existing === 'conflict' ||
              existing.start !== point.start ||
              existing.end !== point.end
            ? 'conflict'
            : existing,
      );
    }
  }
  return { quarters, years };
}

function deriveQ4(
  flow: {
    quarters: Map<string, Point | 'conflict'>;
    years: Map<number, Point | 'conflict'>;
  },
  concept: string | undefined,
  unit: string | undefined,
): Map<string, Point> {
  const derived = new Map<string, Point>();
  if (!concept || !unit) return derived;
  for (const [fiscalYear, year] of flow.years) {
    if (year === 'conflict') continue;
    if (flow.quarters.get(quarterKey(fiscalYear, 4))) continue;
    const q1 = flow.quarters.get(quarterKey(fiscalYear, 1));
    const q2 = flow.quarters.get(quarterKey(fiscalYear, 2));
    const q3 = flow.quarters.get(quarterKey(fiscalYear, 3));
    if (!isPoint(q1) || !isPoint(q2) || !isPoint(q3)) continue;
    if (!q1.start || !year.start || q1.start !== year.start) continue;
    if (addDays(q1.end, 1) !== q2.start || addDays(q2.end, 1) !== q3.start) {
      continue;
    }
    const start = addDays(q3.end, 1);
    if (!start || start > year.end || q3.end >= year.end) continue;
    const value = year.val - q1.val - q2.val - q3.val;
    if (!Number.isSafeInteger(value)) continue;
    const inputs = [year, q1, q2, q3];
    derived.set(quarterKey(fiscalYear, 4), {
      concept,
      unit,
      start,
      end: year.end,
      val: value,
      accn: year.accn,
      form: year.form,
      filed:
        inputs
          .map((point) => point.filed)
          .sort()
          .at(-1) ?? year.filed,
      sourceUrl: year.sourceUrl,
      span: 'quarter',
      fiscalYear,
      fiscalQuarter: 4,
      restated: inputs.some((point) => point.restated),
      derived: true,
      formula: 'full_year - q1 - q2 - q3',
      inputs,
    });
  }
  return derived;
}

function latestQuarter(
  flow: { quarters: Map<string, Point | 'conflict'> },
  derived: Map<string, Point>,
): Point | undefined {
  const points = [
    ...[...flow.quarters.values()].filter(isPoint),
    ...derived.values(),
  ];
  return points.sort(
    (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
  )[0];
}

function latestYear(years: Map<number, Point | 'conflict'>): Point | undefined {
  return [...years.values()]
    .filter(isPoint)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
}

function quarterPoint(
  quarters: Map<string, Point | 'conflict'>,
  derived: Map<string, Point>,
  fiscalYear: number,
  fiscalQuarter: Quarter,
): Point | undefined {
  const explicit = quarters.get(quarterKey(fiscalYear, fiscalQuarter));
  if (explicit === 'conflict') return undefined;
  return explicit ?? derived.get(quarterKey(fiscalYear, fiscalQuarter));
}

function yearPoint(
  years: Map<number, Point | 'conflict'>,
  fiscalYear: number,
): Point | undefined {
  const point = years.get(fiscalYear);
  return isPoint(point) ? point : undefined;
}

function trailing(
  quarters: Map<string, Point | 'conflict'>,
  derived: Map<string, Point>,
  latest: Point | undefined,
): CompanyMetric {
  if (!latest) return unavailable('insufficient_periods');
  const parts = [latest];
  let fiscalYear = latest.fiscalYear;
  let fiscalQuarter = latest.fiscalQuarter;
  for (let step = 0; step < 3; step++) {
    if (fiscalQuarter === 1) {
      fiscalYear -= 1;
      fiscalQuarter = 4;
    } else {
      fiscalQuarter = (fiscalQuarter - 1) as Quarter;
    }
    const point = quarterPoint(quarters, derived, fiscalYear, fiscalQuarter);
    if (!point) return unavailable('insufficient_periods');
    parts.push(point);
  }
  const value = parts.reduce((sum, point) => sum + point.val, 0);
  if (!Number.isSafeInteger(value)) return unavailable('not_comparable');
  return {
    available: true,
    value,
    unit: latest.unit,
    display: formatMoney(value, latest.unit),
    derived: true,
    formula: 'q + q-1 + q-2 + q-3',
    inputCitations: parts.map(citation),
  };
}

function growth(current?: Point, prior?: Point): CompanyMetric {
  if (!current || !prior) return unavailable('insufficient_periods');
  if (current.unit !== prior.unit) return unavailable('mixed_currency');
  if (prior.val === 0) return unavailable('zero_denominator');
  const ratio = round6((current.val - prior.val) / prior.val);
  return {
    available: true,
    value: ratio,
    display: formatPercent(ratio),
    derived: true,
    formula: '(current - prior) / prior',
    inputCitations: [citation(prior), citation(current)],
  };
}

function margin(
  income: Point | undefined,
  revenue: Point | undefined,
): CompanyMetric {
  if (!income || !revenue) return unavailable('missing');
  if (income.unit !== revenue.unit) return unavailable('mixed_currency');
  if (income.start !== revenue.start || income.end !== revenue.end) {
    return unavailable('not_comparable');
  }
  if (revenue.val === 0) return unavailable('zero_denominator');
  const ratio = round6(income.val / revenue.val);
  return {
    available: true,
    value: ratio,
    display: formatPercent(ratio),
    derived: true,
    formula: 'operating_income / revenue',
    inputCitations: [citation(income), citation(revenue)],
  };
}

function metricFrom(series: Series, point: Point | undefined): CompanyMetric {
  if (series.kind === 'mixed') return unavailable('mixed_currency');
  if (!point) return unavailable('missing');
  return {
    available: true,
    value: point.val,
    unit: point.unit,
    display: formatMoney(point.val, point.unit),
    derived: point.derived || undefined,
    formula: point.formula,
    restated: point.restated || undefined,
    priorValue: point.priorValue,
    priorAccession: point.priorAccession,
    priorFiled: point.priorFiled,
    citation: point.derived ? undefined : citation(point),
    inputCitations: point.inputs?.map(citation),
  };
}

function instantMetric(series: Series): CompanyMetric {
  if (series.kind === 'mixed') return unavailable('mixed_currency');
  if (series.kind === 'empty') return unavailable('missing');
  const point = series.points
    .filter((item) => item.span === 'instant')
    .sort(
      (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
    )[0];
  return metricFrom(series, point);
}

function citation(point: Point): CompanyCitation {
  return {
    concept: point.concept,
    form: point.form,
    accession: point.accn,
    filed: point.filed,
    periodStart: point.start,
    periodEnd: point.end,
    sourceUrl: point.sourceUrl,
    unit: point.unit,
    value: point.val,
  };
}

function unavailable(reason: CompanyMetricReason): CompanyMetric {
  return { available: false, reason };
}

function pointsOf(series: Series): Point[] {
  return series.kind === 'points' ? series.points : [];
}

function unitOf(series: Series): string | undefined {
  return series.kind === 'points' ? series.unit : undefined;
}

function conceptOf(series: Series): string | undefined {
  return series.kind === 'points' ? series.points[0]?.concept : undefined;
}

function isPoint(value: Point | 'conflict' | undefined): value is Point {
  return Boolean(value) && value !== 'conflict';
}

function quarterKey(fiscalYear: number, fiscalQuarter: Quarter): string {
  return `${fiscalYear}:${fiscalQuarter}`;
}

function cleanForm(form: string | undefined): string {
  return form && FORMS.has(form) ? form : 'filing';
}

function cadence(filings: CompanyFiling[], asOf: string): 'current' | 'stale' {
  const newest = filings
    .filter((filing) =>
      ['10-K', '10-Q', '10-K/A', '10-Q/A'].includes(filing.form),
    )
    .map((filing) => filing.filed)
    .sort()
    .at(-1);
  const end = dayNumber(asOf);
  const filed = newest ? dayNumber(newest) : undefined;
  if (end === undefined || filed === undefined) return 'stale';
  return end - filed <= 120 ? 'current' : 'stale';
}

function collectLinks(
  metrics: Array<CompanyMetric | undefined>,
  filings: CompanyFiling[],
): CompanyResearchData['links'] {
  const links: CompanyResearchData['links'] = [];
  const add = (label: string, url: string) => {
    if (!url.startsWith('https://www.sec.gov/Archives/edgar/data/')) return;
    if (links.some((link) => link.url === url)) return;
    links.push({ label, url });
  };
  for (const metric of metrics) {
    for (const item of [metric?.citation, ...(metric?.inputCitations ?? [])]) {
      if (!item) continue;
      add(`${item.form} filed ${item.filed}`, item.sourceUrl);
    }
  }
  for (const filing of filings) {
    add(`${filing.form} filed ${filing.filed}`, filing.sourceUrl);
  }
  return links;
}

function briefingLines(input: {
  name: string;
  ticker: string;
  cik: string;
  quarter?: CompanyPeriod;
  annual?: CompanyPeriod;
  ttm: CompanyMetric;
  quarterlyRevenue?: CompanyMetric;
  quarterlyGrowth: CompanyMetric;
  annualGrowth: CompanyMetric;
  margin?: CompanyMetric;
  cadence: 'current' | 'stale';
  filingsNote?: string;
}): string[] {
  const lines = [
    `${input.name} (${input.ticker}) company figures use SEC CIK ${input.cik}.`,
  ];
  const quarterRevenue = input.quarterlyRevenue ?? input.quarter?.revenue;
  if (quarterRevenue?.available && quarterRevenue.display && input.quarter) {
    lines.push(
      input.quarter.derived
        ? `Derived FY${input.quarter.fiscalYear} Q${input.quarter.fiscalQuarter} (${input.quarter.start} to ${input.quarter.end}) revenue is ${quarterRevenue.display}, from full-year minus Q1, Q2 and Q3.`
        : `Latest quarter FY${input.quarter.fiscalYear} Q${input.quarter.fiscalQuarter} (${input.quarter.start} to ${input.quarter.end}) revenue is ${quarterRevenue.display}, ${quarterRevenue.citation?.form} filed ${quarterRevenue.citation?.filed}, accession ${quarterRevenue.citation?.accession}.`,
    );
    if (
      quarterRevenue.restated &&
      quarterRevenue.priorValue !== undefined &&
      quarterRevenue.priorAccession
    ) {
      lines.push(
        `That revenue was revised from ${formatMoney(quarterRevenue.priorValue, quarterRevenue.unit ?? 'USD')} in accession ${quarterRevenue.priorAccession} filed ${quarterRevenue.priorFiled}.`,
      );
    }
  } else {
    lines.push(
      `Quarterly revenue is unavailable (${quarterRevenue?.reason ?? 'insufficient_periods'}).`,
    );
  }
  lines.push(
    metricSentence('Latest quarter net income', input.quarter?.netIncome),
  );
  lines.push(
    input.margin?.available && input.margin.display
      ? `Operating margin for the latest comparable period is ${input.margin.display}.`
      : `Operating margin is unavailable (${input.margin?.reason ?? 'missing'}).`,
  );
  lines.push(
    input.ttm.available && input.ttm.display
      ? `Trailing twelve-month revenue is ${input.ttm.display}.`
      : `Trailing twelve-month revenue is unavailable (${input.ttm.reason ?? 'insufficient_periods'}).`,
  );
  if (input.annual?.revenue.available && input.annual.revenue.display) {
    lines.push(
      `Full-year FY${input.annual.fiscalYear} revenue is ${input.annual.revenue.display}.`,
    );
  } else {
    lines.push('Full-year revenue is unavailable (missing).');
  }
  lines.push(
    input.annualGrowth.available && input.annualGrowth.display && input.annual
      ? `Full-year revenue changed ${input.annualGrowth.display} from FY${input.annual.fiscalYear - 1}.`
      : `Full-year revenue growth is unavailable (${input.annualGrowth.reason ?? 'insufficient_periods'}).`,
  );
  lines.push(
    input.quarterlyGrowth.available && input.quarterlyGrowth.display
      ? `Quarterly revenue changed ${input.quarterlyGrowth.display} from the same quarter a year earlier.`
      : `Quarterly revenue growth is unavailable (${input.quarterlyGrowth.reason ?? 'insufficient_periods'}).`,
  );
  if (input.cadence === 'stale') {
    lines.push('The newest 10-K or 10-Q on file is older than 120 days.');
  }
  if (input.filingsNote) lines.push(input.filingsNote);
  lines.push(
    'These figures are filing facts. They are not the Oren Score and not a recommendation.',
  );
  return lines;
}

function metricSentence(
  label: string,
  metric: CompanyMetric | undefined,
): string {
  if (metric?.available && metric.display)
    return `${label} is ${metric.display}.`;
  return `${label} is unavailable (${metric?.reason ?? 'missing'}).`;
}

function safeLabel(name: string): string {
  return /^[A-Za-z0-9 .,&'-]{1,80}$/.test(name) ? name : 'This company';
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

export function formatMoney(value: number, unit: string): string {
  const negative = value < 0;
  const digits = Math.abs(value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const prefix = /^[A-Z]{3}$/.test(unit) && unit === 'USD' ? '$' : `${unit} `;
  return `${negative ? '-' : ''}${prefix}${grouped}`;
}

export function formatPercent(ratio: number): string {
  const pct = Math.round(ratio * 10_000) / 100;
  const negative = pct < 0;
  const abs = Math.abs(pct);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${negative ? '-' : ''}${text}%`;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function dayNumber(iso: string): number | undefined {
  if (!DATE.test(iso)) return undefined;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  return utc / 86_400_000;
}

function addDays(iso: string, days: number): string | undefined {
  const day = dayNumber(iso);
  if (day === undefined) return undefined;
  return new Date((day + days) * 86_400_000).toISOString().slice(0, 10);
}
