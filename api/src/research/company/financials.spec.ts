import {
  fiscalYearForAnnualEnd,
  normalizeFinancials,
  type NormalizedFactInput,
} from './financials';

const CIK = '0000320193';

function fact(
  partial: Partial<NormalizedFactInput> &
    Pick<NormalizedFactInput, 'end' | 'val'>,
): NormalizedFactInput {
  return {
    concept: 'Revenues',
    unit: 'USD',
    accn: '0000320193-26-000001',
    form: '10-Q',
    filed: '2026-05-01',
    ...partial,
  };
}

function run(
  facts: NormalizedFactInput[],
  options?: { asOf?: string; fiscalYearEndMonth?: number; filings?: [] },
) {
  return normalizeFinancials({
    name: 'Apple',
    ticker: 'AAPL',
    cik: CIK,
    fiscalYearEndMonth: options?.fiscalYearEndMonth ?? 12,
    asOf: options?.asOf ?? '2026-12-31',
    facts,
    filings: options?.filings ?? [
      {
        form: '10-Q',
        filed: '2026-11-03',
        accession: '0000320193-26-000026',
        sourceUrl:
          'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.html',
      },
    ],
  });
}

describe('fiscal labels', () => {
  it('keeps a year end that spills a few days past the fiscal-year-end month', () => {
    expect(fiscalYearForAnnualEnd('2026-02-01', 1)).toBe(2026);
    expect(fiscalYearForAnnualEnd('2026-10-02', 9)).toBe(2026);
    expect(fiscalYearForAnnualEnd('2026-09-26', 9)).toBe(2026);
    expect(fiscalYearForAnnualEnd('2017-04-01', 9)).toBeUndefined();
  });

  it('labels a January fiscal Q4 that ends on February 1 from the period chain', () => {
    const result = run(
      [
        fact({
          start: '2025-02-03',
          end: '2026-02-01',
          val: 100,
          form: '10-K',
          filed: '2026-02-20',
          accn: '0000320193-26-000021',
          fy: 2027,
          fp: 'Q1',
        }),
        fact({
          start: '2025-02-03',
          end: '2025-05-04',
          val: 10,
          form: '10-Q',
          filed: '2025-06-01',
          accn: '0000320193-25-000001',
          fy: 2027,
          fp: 'Q1',
        }),
        fact({
          start: '2025-05-05',
          end: '2025-08-03',
          val: 20,
          form: '10-Q',
          filed: '2025-09-01',
          accn: '0000320193-25-000002',
        }),
        fact({
          start: '2025-08-04',
          end: '2025-11-02',
          val: 30,
          form: '10-Q',
          filed: '2025-12-01',
          accn: '0000320193-25-000003',
        }),
      ],
      { fiscalYearEndMonth: 1, asOf: '2026-03-01' },
    );
    expect(result.data.latestAnnual).toMatchObject({
      fiscalYear: 2026,
      revenue: { value: 100 },
    });
    expect(result.data.latestAnnual?.fiscalYear).not.toBe(2027);
    expect(result.data.latestQuarter).toMatchObject({
      fiscalYear: 2026,
      fiscalQuarter: 4,
      derived: true,
      end: '2026-02-01',
      revenue: { value: 40 },
    });
    expect(result.data.ttm?.revenue.value).toBe(100);
    expect(result.data.latestQuarter?.fiscalQuarter).not.toBe(1);
  });

  it('does not treat a spilled annual total as next year Q1 when no quarters exist', () => {
    const result = run(
      [
        fact({
          start: '2025-10-04',
          end: '2026-10-02',
          val: 100,
          form: '10-K',
          filed: '2026-10-20',
          accn: '0000320193-26-000030',
          fy: 2027,
          fp: 'Q1',
        }),
      ],
      { fiscalYearEndMonth: 9, asOf: '2026-11-01' },
    );
    expect(result.data.latestAnnual).toMatchObject({
      fiscalYear: 2026,
      revenue: { value: 100 },
    });
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.ttm?.revenue).toMatchObject({
      available: false,
      reason: 'insufficient_periods',
    });
    expect(result.data.ttm?.revenue.value).toBeUndefined();
  });

  it('does not let a copied filing fp label a quarter that has no chain', () => {
    const result = run(
      [
        fact({
          start: '2024-10-28',
          end: '2025-01-26',
          val: 80,
          filed: '2026-02-25',
          form: '10-K',
          accn: '0000320193-26-000021',
          fy: 2026,
          fp: 'Q1',
        }),
      ],
      { fiscalYearEndMonth: 1, asOf: '2026-03-01' },
    );
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.briefing.join(' ')).toContain('not_comparable');
    expect(JSON.stringify(result.data.latestQuarter ?? {})).not.toContain(
      '"fiscalQuarter":1',
    );
  });
});

describe('period arithmetic', () => {
  it('keeps an amended value only after it is filed and cites the prior value', () => {
    const facts = [
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-05-01',
        form: '10-Q',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 105,
        filed: '2026-06-01',
        form: '10-Q/A',
        accn: '0000320193-26-000002',
      }),
    ];
    const before = run(facts, { asOf: '2026-05-15' });
    expect(before.data.latestQuarter?.revenue).toMatchObject({
      value: 100,
      restated: undefined,
      citation: { accession: '0000320193-26-000001', filed: '2026-05-01' },
    });
    expect(JSON.stringify(before.data)).not.toContain('105');

    const after = run(facts, { asOf: '2026-07-01' });
    expect(after.data.latestQuarter?.revenue).toMatchObject({
      value: 105,
      restated: true,
      priorValue: 100,
      priorAccession: '0000320193-26-000001',
      priorFiled: '2026-05-01',
      citation: { accession: '0000320193-26-000002', form: '10-Q/A' },
    });
  });

  it('does not mark a repeated identical fact as a restatement', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-05-01',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-11-03',
        form: '10-K',
        accn: '0000320193-26-000009',
      }),
    ]);
    expect(result.data.latestQuarter?.revenue).toMatchObject({
      value: 100,
      citation: { accession: '0000320193-26-000009' },
    });
    expect(result.data.latestQuarter?.revenue.restated).toBeUndefined();
  });

  it('does not sum year-to-date facts into a quarter or a trailing total', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-06-30',
        val: 1000,
        accn: '0000320193-26-000011',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-09-30',
        val: 3000,
        accn: '0000320193-26-000012',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-11-15',
        val: 6000,
        accn: '0000320193-26-000013',
      }),
    ]);
    const text = JSON.stringify(result.data);
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.ttm?.revenue).toMatchObject({
      available: false,
      reason: 'insufficient_periods',
    });
    expect(result.data.ttm?.revenue.value).toBeUndefined();
    expect(text).not.toContain('"value":1000');
    expect(text).not.toContain('"value":3000');
    expect(text).not.toContain('"value":6000');
    expect(text).not.toContain('$6,000');
    expect(text).not.toContain('$10,000');
  });

  it('leaves growth unavailable when four quarters or a prior year do not exist', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 10,
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-04-01',
        end: '2026-06-30',
        val: 11,
        accn: '0000320193-26-000002',
      }),
      fact({
        start: '2026-07-01',
        end: '2026-09-30',
        val: 12,
        accn: '0000320193-26-000003',
      }),
    ]);
    expect(result.data.ttm?.revenue.reason).toBe('insufficient_periods');
    expect(result.data.growth?.quarterlyRevenue.reason).toBe(
      'insufficient_periods',
    );
    expect(result.data.growth?.annualRevenue.reason).toBe(
      'insufficient_periods',
    );
    expect(result.data.ttm?.revenue.value).toBeUndefined();
  });

  it('does not divide by a zero prior value or treat missing income as zero', () => {
    const result = run(
      [
        fact({
          start: '2025-01-01',
          end: '2025-12-31',
          val: 0,
          form: '10-K',
          filed: '2026-02-01',
          accn: '0000320193-26-000001',
        }),
        fact({
          start: '2026-01-01',
          end: '2026-12-31',
          val: 10,
          form: '10-K',
          filed: '2027-02-01',
          accn: '0000320193-27-000001',
        }),
        fact({
          concept: 'OperatingIncomeLoss',
          start: '2026-01-01',
          end: '2026-03-31',
          val: 4,
          accn: '0000320193-26-000004',
        }),
        fact({
          start: '2026-01-01',
          end: '2026-03-31',
          val: 0,
          accn: '0000320193-26-000005',
        }),
      ],
      { asOf: '2027-03-01' },
    );
    expect(result.data.latestAnnual?.revenue.value).toBe(10);
    expect(result.data.growth?.annualRevenue).toMatchObject({
      available: false,
      reason: 'zero_denominator',
    });
    expect(result.data.growth?.annualRevenue.value).toBeUndefined();
    expect(result.data.latestQuarter?.revenue).toMatchObject({
      value: 0,
      display: '$0',
    });
    expect(result.data.latestQuarter?.netIncome).toMatchObject({
      available: false,
      reason: 'missing',
    });
    expect(result.data.latestQuarter?.netIncome.value).toBeUndefined();
    expect(result.data.latestQuarter?.operatingMargin).toMatchObject({
      available: false,
      reason: 'zero_denominator',
    });
    expect(
      JSON.stringify(result.data.latestQuarter?.operatingMargin),
    ).not.toContain('"value":0');
    expect(JSON.stringify(result.data)).not.toContain('Infinity');
  });

  it('computes a margin from the same period and refuses mixed currencies', () => {
    const comparable = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 200,
        accn: '0000320193-26-000001',
      }),
      fact({
        concept: 'OperatingIncomeLoss',
        start: '2026-01-01',
        end: '2026-03-31',
        val: 50,
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(comparable.data.latestQuarter?.operatingMargin).toMatchObject({
      value: 0.25,
      display: '25%',
      formula: 'operating_income / revenue',
    });

    const mixed = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        unit: 'EUR',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 90,
        unit: 'GBP',
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(mixed.data.briefing.join(' ')).toContain('mixed_currency');
    expect(JSON.stringify(mixed.data.latestQuarter ?? {})).not.toContain('190');
    expect(JSON.stringify(mixed.data)).not.toContain('"value":90');
    expect(JSON.stringify(mixed.data)).not.toContain('"value":100');
  });

  it('uses USD when it is present and does not add another currency or a share count', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 90,
        unit: 'EUR',
        accn: '0000320193-26-000002',
      }),
      fact({
        start: '2026-04-01',
        end: '2026-06-30',
        val: 200,
        unit: 'EUR',
        accn: '0000320193-26-000003',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 5,
        unit: 'shares',
        accn: '0000320193-26-000004',
      }),
    ]);
    expect(result.data.latestQuarter?.revenue.value).toBe(100);
    expect(JSON.stringify(result.data.latestQuarter)).not.toContain('200');
    expect(JSON.stringify(result.data.latestQuarter?.revenue)).not.toContain(
      '105',
    );
  });

  it('does not combine two different periods that share a quarter start', () => {
    const result = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-25',
        val: 40,
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 70,
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(result.data.latestQuarter).toBeUndefined();
    expect(result.data.ttm?.revenue.reason).toBe('not_comparable');
    expect(JSON.stringify(result.data)).not.toContain('110');
    expect(JSON.stringify(result.data)).not.toContain('"value":40');
    expect(JSON.stringify(result.data)).not.toContain('"value":70');
  });

  it('withholds an unexplained later value instead of calling it a restatement', () => {
    const period = {
      start: '2025-09-28',
      end: '2025-12-27',
    };
    const result = run(
      [
        fact({
          ...period,
          val: 143756000000,
          filed: '2026-01-30',
          form: '10-Q',
          accn: '0000320193-26-000006',
        }),
        fact({
          ...period,
          val: 9000000000,
          filed: '2026-02-15',
          form: '10-Q',
          accn: '0000320193-26-000007',
        }),
      ],
      { fiscalYearEndMonth: 9, asOf: '2026-03-01' },
    );
    const text = JSON.stringify(result.data);
    expect(text).not.toContain('9000000000');
    expect(text).not.toContain('143756000000');
    expect(text).not.toContain('restated');
    expect(result.data.briefing.join(' ')).toContain('not_comparable');
    const before = run(
      [
        fact({
          ...period,
          val: 143756000000,
          filed: '2026-01-30',
          form: '10-Q',
          accn: '0000320193-26-000006',
        }),
        fact({
          ...period,
          val: 9000000000,
          filed: '2026-02-15',
          form: '10-Q',
          accn: '0000320193-26-000007',
        }),
      ],
      { fiscalYearEndMonth: 9, asOf: '2026-02-01' },
    );
    expect(before.data.latestQuarter?.revenue.value).toBe(143756000000);
    expect(JSON.stringify(before.data)).not.toContain('9000000000');
  });

  it('keeps an amending form as a restatement and ignores a repeated comparative', () => {
    const amended = run([
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 100,
        filed: '2026-05-01',
        form: '10-Q',
        accn: '0000320193-26-000001',
      }),
      fact({
        start: '2026-01-01',
        end: '2026-03-31',
        val: 105,
        filed: '2026-06-01',
        form: '10-Q/A',
        accn: '0000320193-26-000002',
      }),
    ]);
    expect(amended.data.latestQuarter?.revenue).toMatchObject({
      value: 105,
      restated: true,
      priorValue: 100,
      priorAccession: '0000320193-26-000001',
    });
  });

  it('marks filings stale when the newest periodic report is older than 120 days', () => {
    const result = normalizeFinancials({
      name: 'Apple',
      ticker: 'AAPL',
      cik: CIK,
      fiscalYearEndMonth: 12,
      asOf: '2026-11-08',
      facts: [],
      filings: [
        {
          form: '10-Q',
          filed: '2026-01-01',
          accession: '0000320193-26-000001',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.html',
        },
      ],
    });
    expect(result.filingCadence).toBe('stale');
    expect(result.data.briefing.join(' ')).toContain('older than 120 days');
  });
});
