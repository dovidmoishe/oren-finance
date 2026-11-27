import { deflateSync } from 'node:zlib';
import {
  BEA_API_URL,
  BLS_API_URL_V1,
  BLS_API_URL_V2,
  CENSUS_MARTS_URL,
  DOL_CLAIMS_RELEASE_URL,
  DOL_CLAIMS_URL,
  OfficialDataClient,
  OfficialSourceError,
  htmlToText,
  parseBeaReleaseDates,
  parseBeaTable,
  parseBlsSeries,
  parseCensusRetail,
  parseClaimsHeadline,
  parseFomcDecision,
  parseWeeklyClaims,
  pdfText,
} from './official-data.client';

/** A one-page PDF whose content stream shows `strings` with TJ, Flate-compressed. */
function fakePdf(strings: string[]): Uint8Array<ArrayBuffer> {
  const shown = strings.map((value) => `(${value})`).join(' -12 ');
  const stream = deflateSync(
    Buffer.from(`BT /F1 10 Tf 72 720 Td [${shown}] TJ ET`, 'latin1'),
  );
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(
        `%PDF-1.7\n1 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
        'latin1',
      ),
      stream,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ]),
  );
}

/** The error a call throws, or undefined when it does not throw. */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

// The 25 Nov 2026 release (USDL 26-1732-NAT), as its PDF shows it.
const CLAIMS_RELEASE =
  "In the week ending November 21, the advance figure for seasonally adjusted initial claims was 189,000, a decrease of 13,000 from the previous week's revised level. The previous week's level was revised down by 1,000 from 203,000 to 202,000.";

// Shapes copied from live answers on 27 Nov 2026, trimmed.
const BLS_ANSWER = {
  status: 'REQUEST_SUCCEEDED',
  responseTime: 14,
  message: [],
  Results: {
    series: [
      {
        seriesID: 'CUSR0000SA0',
        data: [
          {
            year: '2026',
            period: 'M10',
            periodName: 'October',
            latest: 'true',
            value: '337.476',
            footnotes: [{}],
          },
          {
            year: '2026',
            period: 'M09',
            periodName: 'September',
            value: '336.298',
            footnotes: [{}],
          },
          {
            year: '2025',
            period: 'M13',
            periodName: 'Annual',
            value: '320.0',
            footnotes: [{}],
          },
        ],
      },
      {
        seriesID: 'CES0000000001',
        data: [
          {
            year: '2026',
            period: 'M10',
            periodName: 'October',
            latest: 'true',
            value: '159293',
            footnotes: [{ code: 'P', text: 'preliminary' }],
          },
          {
            year: '2026',
            period: 'M09',
            periodName: 'September',
            value: '-',
            footnotes: [{}],
          },
        ],
      },
    ],
  },
};

const BEA_NO_KEY = {
  BEAAPI: {
    Request: {
      RequestParam: [
        { ParameterName: 'USERID', ParameterValue: 'secret-bea-key' },
        { ParameterName: 'METHOD', ParameterValue: 'GETDATA' },
      ],
    },
    Results: {
      Error: {
        APIErrorCode: '1',
        APIErrorDescription: 'Invalid Request - Invalid API UserId.',
      },
    },
  },
};

const BEA_GDP = {
  BEAAPI: {
    Request: { RequestParam: [] },
    Results: {
      Statistic: 'NIPA Table',
      Data: [
        {
          TableName: 'T10101',
          SeriesCode: 'A191RL',
          LineNumber: '1',
          LineDescription: 'Gross domestic product',
          TimePeriod: '2026Q2',
          DataValue: '3.8',
          NoteRef: 'T10101',
        },
        {
          TableName: 'T10101',
          SeriesCode: 'A191RL',
          LineNumber: '1',
          LineDescription: 'Gross domestic product',
          TimePeriod: '2026Q3',
          DataValue: '4.3',
          NoteRef: 'T10101',
        },
        {
          TableName: 'T10101',
          LineNumber: '2',
          TimePeriod: '2026Q3',
          DataValue: '(NA)',
        },
      ],
      Notes: [
        {
          NoteRef: 'T10101',
          NoteText:
            'Table 1.1.1. Percent Change From Preceding Period in Real Gross Domestic Product - Last Revised on: November 25, 2026 - Next Release Date: December 23, 2026',
        },
      ],
    },
  },
};

const BEA_DATES = {
  'Gross Domestic Product': {
    release_dates: [
      '2026-11-25T13:30:00+00:00',
      '2026-12-23T13:30:00+00:00',
      '2026-12-23T13:30:00+00:00',
      'not a date',
    ],
  },
  'Personal Income and Outlays': {
    release_dates: ['2026-12-23T13:30:00+00:00'],
  },
  'U.S. International Trade in Goods and Services': {
    release_dates: ['2026-12-08T13:30:00+00:00'],
  },
  file_last_updated: '2026-11-20',
};

const CENSUS_ANSWER = [
  [
    'cell_value',
    'data_type_code',
    'category_code',
    'seasonally_adj',
    'error_data',
    'time',
    'us',
  ],
  ['0.4', 'MPCSM', '44X72', 'yes', 'no', '2026-09', '1'],
  ['0.6', 'MPCSM', '44X72', 'yes', 'no', '2026-10', '1'],
  ['1.1', 'MPCSM', '44X72', 'no', 'no', '2026-10', '1'],
  ['0.2', 'E_MPCSM', '44X72', 'yes', 'yes', '2026-10', '1'],
  ['740123', 'SM', '44X72', 'yes', 'no', '2026-10', '1'],
  ['0.9', 'MPCSM', '441X', 'yes', 'no', '2026-10', '1'],
];

const CLAIMS_XML = `<r539cyNational rundate="11/26/2026">
<week>
<weekEnded>11/14/2026</weekEnded>
<InitialClaims>
<NSA>230,100</NSA>
<SF>101.2</SF>
<SA>220,000</SA>
<SA4WK>218,250</SA4WK>
</InitialClaims>
<ContinuedClaims>
<NSA>1,800,000</NSA>
<SA>1,875,000</SA>
</ContinuedClaims>
</week>
<week>
<weekEnded>11/21/2026</weekEnded>
<InitialClaims>
<NSA>250,000</NSA>
<SF>115.7</SF>
<SA>216,000</SA>
<SA4WK>217,000</SA4WK>
</InitialClaims>
</week>
<week>
<weekEnded>11/28/2026</weekEnded>
<InitialClaims>
<NSA>&#160;</NSA>
<SF>120.8</SF>
<SA>&#160;</SA>
<SA4WK>&#160;</SA4WK>
</InitialClaims>
</week>
</r539cyNational>`;

// Sentences from the 10 Dec 2025, 16 Sep 2026, and 28 Oct 2026 statements.
// The December one writes "3‑3/4" with a non-breaking hyphen.
const CUT =
  'In support of its goals and in light of the shift in the balance of risks, the Committee decided to lower the target range for the federal funds rate by 1/4 percentage point to 3-1/2 to 3‑3/4 percent. Voting against this action were Stephen I. Miran, who preferred to lower the target range for the federal funds rate by 1/2 percentage point at this meeting.';
const HIKE =
  "The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent, in support of the Federal Reserve's dual mandate.";
const HOLD =
  "The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent, in support of the Federal Reserve's dual mandate. Voting against the action was Beth M. Hammack, who preferred to raise the target range for the federal funds rate by 1/4 percentage point at this meeting.";

describe('official source parsers', () => {
  it('reads BLS monthly series, skipping annual averages and gaps', () => {
    const series = parseBlsSeries(BLS_ANSWER);
    expect(series.get('CUSR0000SA0')).toEqual([
      { period: '2026-09', value: 336.298 },
      { period: '2026-10', value: 337.476 },
    ]);
    expect(series.get('CES0000000001')).toEqual([
      { period: '2026-09', value: null },
      { period: '2026-10', value: 159293 },
    ]);
    expect(
      thrown(() =>
        parseBlsSeries({
          status: 'REQUEST_NOT_PROCESSED',
          message: [
            "Request could not be serviced, as the daily threshold for total number of requests allocated to the user with registration key 'secret-bls-key' has been reached.",
          ],
        }),
      ),
    ).toMatchObject({ source: 'bls', code: 'rate_limited' });
    // BLS quotes a refused key back; only the kind of refusal is kept.
    const refused = thrown(() =>
      parseBlsSeries({
        status: 'REQUEST_NOT_PROCESSED',
        responseTime: 0,
        message: [
          'The key:secret-bls-key provided by the User is invalid. Please provide a proper key for the operation to be successful',
        ],
        Results: {},
      }),
    );
    expect(refused).toMatchObject({ source: 'bls', code: 'key_rejected' });
    expect(String(refused)).not.toContain('secret-bls-key');
    expect(
      thrown(() =>
        parseBlsSeries({
          status: 'REQUEST_NOT_PROCESSED',
          message: ['Series does not exist for Series CUXX'],
        }),
      ),
    ).toMatchObject({ source: 'bls', code: 'api_error' });
  });

  it('reads a BEA table and the revision date in its notes', () => {
    expect(parseBeaTable(BEA_GDP)).toEqual({
      rows: [
        { line: '1', period: '2026-Q2', value: 3.8 },
        { line: '1', period: '2026-Q3', value: 4.3 },
        { line: '2', period: '2026-Q3', value: null },
      ],
      lastRevised: '2026-11-25',
    });
    const monthly = parseBeaTable({
      BEAAPI: {
        Results: {
          Data: [{ LineNumber: '1', TimePeriod: '2026M10', DataValue: '0.2' }],
          Notes: [{ NoteText: 'Table 2.8.7 - LastRevised: Nov 25, 2026' }],
        },
      },
    });
    expect(monthly).toEqual({
      rows: [{ line: '1', period: '2026-10', value: 0.2 }],
      lastRevised: '2026-11-25',
    });
  });

  it('turns a BEA error answer into a code without the echoed key', () => {
    const caught = thrown(() => parseBeaTable(BEA_NO_KEY));
    expect(caught).toBeInstanceOf(OfficialSourceError);
    expect(caught).toMatchObject({ source: 'bea', code: 'key_rejected' });
    expect(String(caught)).not.toContain('secret-bea-key');
    const answer = (APIErrorCode: string, APIErrorDescription: string) => ({
      BEAAPI: {
        Request: BEA_NO_KEY.BEAAPI.Request,
        Results: { Error: { APIErrorCode, APIErrorDescription } },
      },
    });
    // A registered key stays inactive until the link in BEA's email is used.
    expect(
      thrown(() =>
        parseBeaTable(
          answer(
            '4',
            'This UserId is not active. Please activate it and try again.',
          ),
        ),
      ),
    ).toMatchObject({ source: 'bea', code: 'key_rejected' });
    expect(
      thrown(() =>
        parseBeaTable(
          answer('201', 'Error retrieving NIPA/Fixed Assets data.'),
        ),
      ),
    ).toMatchObject({ source: 'bea', code: 'api_error' });
  });

  it('reads BEA release dates, deduplicated and sorted', () => {
    expect(parseBeaReleaseDates(BEA_DATES)).toEqual({
      gdp: ['2026-11-25T13:30:00.000Z', '2026-12-23T13:30:00.000Z'],
      personalIncomeAndOutlays: ['2026-12-23T13:30:00.000Z'],
    });
    expect(
      thrown(() => parseBeaReleaseDates({ file_last_updated: 'x' })),
    ).toMatchObject({ code: 'invalid_response' });
  });

  it('keeps only the seasonally adjusted Census series asked for', () => {
    expect(
      parseCensusRetail(CENSUS_ANSWER, {
        category: '44X72',
        dataType: 'MPCSM',
      }),
    ).toEqual([
      { period: '2026-09', value: 0.4 },
      { period: '2026-10', value: 0.6 },
    ]);
    expect(
      thrown(() =>
        parseCensusRetail('<html>Missing Key</html>', {
          category: '44X72',
          dataType: 'MPCSM',
        }),
      ),
    ).toMatchObject({ source: 'census', code: 'invalid_response' });
  });

  it('reads seasonally adjusted initial claims from the ETA XML', () => {
    expect(parseWeeklyClaims(CLAIMS_XML)).toEqual([
      { weekEnded: '2026-11-14', initialClaims: 220000 },
      { weekEnded: '2026-11-21', initialClaims: 216000 },
      { weekEnded: '2026-11-28', initialClaims: null },
    ]);
    expect(thrown(() => parseWeeklyClaims('<html>error</html>'))).toMatchObject(
      { source: 'dol', code: 'invalid_response' },
    );
  });

  it('reads the advance claims figure and the revised prior week from the release', () => {
    expect(parseClaimsHeadline(CLAIMS_RELEASE)).toEqual({
      weekEnded: '11-21',
      initialClaims: 189000,
      previous: 202000,
    });
    expect(
      parseClaimsHeadline(
        'In the week ending December 5, the advance figure for seasonally adjusted initial claims was 220,000, unchanged from the previous week’s level. The previous week’s level was unrevised at 220,000.',
      ),
    ).toEqual({ weekEnded: '12-05', initialClaims: 220000, previous: 220000 });
    expect(parseClaimsHeadline('Unemployment Insurance Weekly Claims')).toBe(
      null,
    );
  });

  it('pulls the headline text out of a compressed PDF', () => {
    // Split across text operators, with the apostrophe as an octal escape.
    const pdf = fakePdf([
      'In the week ending Nov',
      'ember 21, the advance figure for seasonally adjusted initial claims was 189,000, a decrease of 13,000 from the previous week\\222s revised level. ',
      'The previous week\\222s level was revised down by 1,000 from 203,000 to 202,000.',
    ]);
    expect(parseClaimsHeadline(pdfText(pdf))).toEqual({
      weekEnded: '11-21',
      initialClaims: 189000,
      previous: 202000,
    });
    expect(pdfText(Buffer.from('%PDF-1.7 no streams here'))).toBe('');
  });

  it('reads the decision, not a dissent, from an FOMC statement', () => {
    expect(parseFomcDecision(CUT)).toEqual({
      action: 'lower',
      lower: 3.5,
      upper: 3.75,
      previousLower: 3.75,
      previousUpper: 4,
    });
    expect(parseFomcDecision(HIKE)).toEqual({
      action: 'raise',
      lower: 3.75,
      upper: 4,
      previousLower: 3.5,
      previousUpper: 3.75,
    });
    expect(parseFomcDecision(HOLD)).toEqual({
      action: 'maintain',
      lower: 3.75,
      upper: 4,
      previousLower: 3.75,
      previousUpper: 4,
    });
    // March 2020 gave no step size, so the old range is unknown.
    expect(
      parseFomcDecision(
        'The Committee decided to lower the target range for the federal funds rate to 0 to 1/4 percent.',
      ),
    ).toEqual({
      action: 'lower',
      lower: 0,
      upper: 0.25,
      previousLower: null,
      previousUpper: null,
    });
    expect(
      parseFomcDecision(
        'Several participants preferred to lower the target range for the federal funds rate by 1/4 percentage point.',
      ),
    ).toBeNull();
  });

  it('extracts statement text from HTML with entities decoded', () => {
    const html = `<html><head><style>p{}</style><script>var t = "decided to raise";</script></head><body><p>The&nbsp;Committee decided to maintain the target range for the federal funds rate at 3&#8209;3/4 to 4&#160;percent.</p></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain('var t');
    expect(parseFomcDecision(text)).toMatchObject({
      action: 'maintain',
      lower: 3.75,
      upper: 4,
    });
  });
});

describe('OfficialDataClient', () => {
  const json = (body: unknown, status = 200, headers?: HeadersInit) =>
    new Response(JSON.stringify(body), { status, headers });

  function client(
    respond: (url: URL, init: RequestInit) => Response,
    keys: ConstructorParameters<typeof OfficialDataClient>[0] = {},
  ) {
    const fetcher = jest.fn((url: URL, init: RequestInit) =>
      Promise.resolve(respond(url, init)),
    );
    const sleep = jest.fn(() => Promise.resolve());
    return {
      fetcher,
      sleep,
      api: new OfficialDataClient(keys, {
        fetch: fetcher as unknown as typeof fetch,
        sleep,
        minIntervalMs: 0,
      }),
    };
  }

  const request = (fetcher: jest.Mock, index = 0) =>
    fetcher.mock.calls[index] as [URL, RequestInit];

  it('posts BLS series to v1 without a key and to v2 with one', async () => {
    const keyless = client(() => json(BLS_ANSWER));
    await keyless.api.blsSeries(['CUSR0000SA0'], { start: 2025, end: 2026 });
    const [url, init] = request(keyless.fetcher);
    expect(url.href).toBe(BLS_API_URL_V1);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      seriesid: ['CUSR0000SA0'],
      startyear: '2025',
      endyear: '2026',
    });

    const keyed = client(() => json(BLS_ANSWER), { bls: 'bls-key' });
    await keyed.api.blsSeries(['CUSR0000SA0'], { start: 2025, end: 2026 });
    const [keyedUrl, keyedInit] = request(keyed.fetcher);
    expect(keyedUrl.href).toBe(BLS_API_URL_V2);
    expect(JSON.parse(keyedInit.body as string)).toMatchObject({
      registrationkey: 'bls-key',
    });

    // After BLS refuses the key, the refresh asks again without it.
    await keyed.api.blsSeries(['CUSR0000SA0'], {
      start: 2025,
      end: 2026,
      keyless: true,
    });
    const [retryUrl, retryInit] = request(keyed.fetcher, 1);
    expect(retryUrl.href).toBe(BLS_API_URL_V1);
    expect(JSON.parse(retryInit.body as string)).not.toHaveProperty(
      'registrationkey',
    );
  });

  it('needs a key for BEA and Census values but never leaks it', async () => {
    const none = client(() => json({}));
    expect(none.api.configured).toEqual({ bea: false, census: false });
    await expect(
      none.api.beaTable({ table: 'T10101', frequency: 'Q', years: [2026] }),
    ).rejects.toMatchObject({ source: 'bea', code: 'not_configured' });
    await expect(
      none.api.censusRetail({
        category: '44X72',
        dataType: 'MPCSM',
        from: '2026-09',
      }),
    ).rejects.toMatchObject({ source: 'census', code: 'not_configured' });
    expect(none.fetcher).not.toHaveBeenCalled();

    const bea = client(() => json(BEA_NO_KEY), { bea: 'secret-bea-key' });
    const failure = await bea.api
      .beaTable({ table: 'T10101', frequency: 'Q', years: [2025, 2026] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'key_rejected' });
    expect(JSON.stringify(failure)).not.toContain('secret-bea-key');
    expect(String(failure)).not.toContain('secret-bea-key');
    const [url] = request(bea.fetcher);
    expect(url.origin + url.pathname).toBe(BEA_API_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      UserID: 'secret-bea-key',
      TableName: 'T10101',
      Frequency: 'Q',
      Year: '2025,2026',
    });

    // Census sends a missing or bad key to a help page with a redirect.
    const redirectTo = (location: string) =>
      client(() => new Response(null, { status: 302, headers: { location } }), {
        census: 'secret-census-key',
      });
    const retail = { category: '44X72', dataType: 'MPCSM', from: '2026-09' };
    const census = redirectTo('https://api.census.gov/data/invalid_key.html');
    const redirected = await census.api
      .censusRetail(retail)
      .catch((error: unknown) => error);
    expect(redirected).toMatchObject({ code: 'key_rejected', status: 302 });
    expect(String(redirected)).not.toContain('secret-census-key');
    const [censusUrl, censusInit] = request(census.fetcher);
    expect(censusUrl.origin + censusUrl.pathname).toBe(CENSUS_MARTS_URL);
    expect(censusUrl.searchParams.get('time')).toBe('from 2026-09');
    expect(censusInit.redirect).toBe('manual');
    await expect(
      redirectTo(
        'https://api.census.gov/data/missing_key.html',
      ).api.censusRetail(retail),
    ).rejects.toMatchObject({ code: 'key_rejected' });
    // Any other redirect is not a key problem.
    await expect(
      redirectTo(
        'https://www.census.gov/data/developers.html',
      ).api.censusRetail(retail),
    ).rejects.toMatchObject({ code: 'api_error', status: 302 });
  });

  it('posts the claims form and reads FOMC statements, null until published', async () => {
    const { api, fetcher } = client((url) => {
      if (url.href === DOL_CLAIMS_URL)
        return new Response(CLAIMS_XML, {
          headers: { 'content-type': 'text/xml' },
        });
      if (url.pathname.endsWith('monetary20261028a.htm'))
        return new Response(`<html><body><p>${HOLD}</p></body></html>`);
      return new Response('Page not found', { status: 404 });
    });
    expect(await api.weeklyClaims(2026)).toHaveLength(3);
    const [, init] = request(fetcher);
    expect(init.method).toBe('POST');
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      level: 'us',
      strtdate: '2026',
      enddate: '2026',
      filetype: 'xml',
      submit: 'Submit',
    });
    expect(parseFomcDecision((await api.fomcStatement('2026-10-28'))!)).toEqual(
      expect.objectContaining({ action: 'maintain', upper: 4 }),
    );
    expect(await api.fomcStatement('2026-12-09')).toBeNull();

    const release = client((url) =>
      url.href === DOL_CLAIMS_RELEASE_URL
        ? new Response(fakePdf([CLAIMS_RELEASE]), {
            headers: { 'content-type': 'application/pdf' },
          })
        : new Response('Page not found', { status: 404 }),
    );
    await expect(release.api.latestClaimsRelease()).resolves.toEqual({
      weekEnded: '11-21',
      initialClaims: 189000,
      previous: 202000,
    });
  });

  it('backs off on 429 and keeps at most two requests in flight', async () => {
    let answered = 0;
    const retry = client(() =>
      answered++ === 0
        ? json({}, 429, { 'retry-after': '3' })
        : json(BEA_DATES),
    );
    const dates = await retry.api.beaReleaseDates();
    expect(dates.gdp).toHaveLength(2);
    expect(retry.sleep).toHaveBeenCalledWith(3000);

    const stuck = client(() => json({}, 503));
    await expect(stuck.api.beaReleaseDates()).rejects.toMatchObject({
      code: 'http_error',
      status: 503,
    });
    expect(stuck.fetcher).toHaveBeenCalledTimes(4);

    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const slow = new OfficialDataClient(
      {},
      {
        minIntervalMs: 0,
        fetch: (() => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          return new Promise<Response>((resolve) =>
            release.push(() => {
              inFlight -= 1;
              resolve(json(BEA_DATES));
            }),
          );
        }) as unknown as typeof fetch,
      },
    );
    const calls = [1, 2, 3, 4].map(() => slow.beaReleaseDates());
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      release.shift()?.();
    }
    await Promise.all(calls);
    expect(peak).toBe(2);
  });

  it('reports network failures and timeouts as codes', async () => {
    const offline = new OfficialDataClient(
      {},
      {
        fetch: (() =>
          Promise.reject(
            new TypeError('fetch failed'),
          )) as unknown as typeof fetch,
      },
    );
    await expect(offline.fomcStatement('2026-12-09')).rejects.toMatchObject({
      source: 'frb',
      code: 'network',
    });
    const slow = new OfficialDataClient(
      {},
      {
        fetch: (() => {
          const error = new Error('timed out');
          error.name = 'TimeoutError';
          return Promise.reject(error);
        }) as unknown as typeof fetch,
      },
    );
    await expect(slow.weeklyClaims(2026)).rejects.toMatchObject({
      source: 'dol',
      code: 'timeout',
    });
  });
});
