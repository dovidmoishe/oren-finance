import { inflateSync } from 'node:zlib';
import type { OfficialAgencyId } from '../../../types/market-calendar';
import { FOMC_DECISION } from './macro-catalog';

/**
 * Client for the agencies behind the official macro calendar: BLS, BEA, the
 * Census Bureau, the Labor Department, and the Federal Reserve Board. Only the
 * refresh worker calls it; the UI, brief, copilot, and MCP read Postgres.
 *
 * Keys travel in query strings (BEA, Census) or a POST body (BLS), and BEA
 * echoes the key back in its responses. Request URLs, bodies, and response
 * text are therefore never logged or rethrown; errors carry a code and an
 * HTTP status only. Requests are spaced, at most two run at once, and 429s
 * and 5xx answers back off before retrying.
 */
export const BLS_API_URL_V1 =
  'https://api.bls.gov/publicAPI/v1/timeseries/data/';
export const BLS_API_URL_V2 =
  'https://api.bls.gov/publicAPI/v2/timeseries/data/';
export const BEA_API_URL = 'https://apps.bea.gov/api/data';
export const BEA_RELEASE_DATES_URL =
  'https://apps.bea.gov/API/signup/release_dates.json';
export const CENSUS_MARTS_URL =
  'https://api.census.gov/data/timeseries/eits/marts';
export const DOL_CLAIMS_URL =
  'https://oui.doleta.gov/unemploy/wkclaims/report.asp';
/** The latest weekly claims news release, replaced every week. */
export const DOL_CLAIMS_RELEASE_URL = 'https://www.dol.gov/ui/data.pdf';

export interface PeriodValue {
  /** YYYY-MM for monthly data. */
  period: string;
  value: number | null;
}

export interface BeaTable {
  /** period is YYYY-Qn for quarterly tables and YYYY-MM for monthly ones. */
  rows: { line: string; period: string; value: number | null }[];
  /** The "Last Revised" date in BEA's table notes, YYYY-MM-DD, when given. */
  lastRevised: string | null;
}

export interface BeaReleaseDates {
  /** ISO instants, oldest first. */
  gdp: string[];
  personalIncomeAndOutlays: string[];
}

export interface ClaimsWeek {
  weekEnded: string;
  /** Seasonally adjusted initial claims; null for weeks not yet published. */
  initialClaims: number | null;
}

/** The headline of the latest weekly claims news release. */
export interface ClaimsHeadline {
  /** Week-ending month and day, MM-DD; the release states no year. */
  weekEnded: string;
  /** The advance figure for seasonally adjusted initial claims. */
  initialClaims: number;
  /** The previous week's level, as revised in this release. */
  previous: number | null;
}

export interface FomcDecision {
  action: 'maintain' | 'raise' | 'lower';
  lower: number;
  upper: number;
  /** Null when the statement gives no step size, so the old range is unknown. */
  previousLower: number | null;
  previousUpper: number | null;
}

/** What the refresh needs from the agencies. Tests substitute a fake. */
export interface OfficialDataApi {
  /** Value sources that need a key and have one. */
  readonly configured: { readonly bea: boolean; readonly census: boolean };
  beaReleaseDates(): Promise<BeaReleaseDates>;
  /**
   * Monthly observations per BLS series, oldest first. `keyless` skips a
   * configured key, for when BLS has rejected it.
   */
  blsSeries(
    seriesIds: readonly string[],
    years: { start: number; end: number; keyless?: boolean },
  ): Promise<Map<string, PeriodValue[]>>;
  beaTable(input: {
    table: string;
    frequency: 'Q' | 'M';
    years: readonly number[];
  }): Promise<BeaTable>;
  /** Seasonally adjusted advance retail estimates from `from` (YYYY-MM) on. */
  censusRetail(input: {
    category: string;
    dataType: string;
    from: string;
  }): Promise<PeriodValue[]>;
  /**
   * Seasonally adjusted claims by week from ETA's weekly data. It trails the
   * news release by a few weeks, so it only backfills older weeks.
   */
  weeklyClaims(year: number): Promise<ClaimsWeek[]>;
  /** The headline of this week's claims news release; null if unreadable. */
  latestClaimsRelease(): Promise<ClaimsHeadline | null>;
  /** Plain text of the FOMC statement for a decision day; null before it is out. */
  fomcStatement(date: string): Promise<string | null>;
}

export type OfficialErrorCode =
  | 'rate_limited'
  | 'http_error'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'api_error'
  | 'not_configured'
  /** The agency refused the configured key: unknown, not activated, or expired. */
  | 'key_rejected';

/** Carries the source, a code, and an HTTP status only. */
export class OfficialSourceError extends Error {
  constructor(
    readonly source: OfficialAgencyId,
    readonly code: OfficialErrorCode,
    readonly status?: number,
  ) {
    super(`${source} request failed: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'OfficialSourceError';
  }
}

export interface OfficialDataKeys {
  /** Optional: without it BLS answers 25 queries a day per IP (v1). */
  bls?: string;
  bea?: string;
  census?: string;
}

export interface OfficialDataClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxConcurrent?: number;
  /** Minimum gap between request starts. */
  minIntervalMs?: number;
  maxRetries?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  json?: unknown;
  form?: URLSearchParams;
  as?: 'json' | 'text' | 'bytes';
  /** Answer null instead of failing on 404, e.g. an FOMC statement not yet out. */
  allowNotFound?: boolean;
}

export class OfficialDataClient implements OfficialDataApi {
  readonly configured: { readonly bea: boolean; readonly census: boolean };
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private nextStart = 0;

  constructor(
    private readonly keys: OfficialDataKeys = {},
    options: OfficialDataClientOptions = {},
  ) {
    this.configured = { bea: Boolean(keys.bea), census: Boolean(keys.census) };
    this.fetcher = options.fetch ?? fetch;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 500);
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
  }

  async beaReleaseDates(): Promise<BeaReleaseDates> {
    return parseBeaReleaseDates(
      await this.request('bea', new URL(BEA_RELEASE_DATES_URL), {}),
    );
  }

  async blsSeries(
    seriesIds: readonly string[],
    { start, end, keyless }: { start: number; end: number; keyless?: boolean },
  ): Promise<Map<string, PeriodValue[]>> {
    const key = keyless ? undefined : this.keys.bls;
    const body = await this.request(
      'bls',
      new URL(key ? BLS_API_URL_V2 : BLS_API_URL_V1),
      {
        method: 'POST',
        json: {
          seriesid: [...seriesIds],
          startyear: String(start),
          endyear: String(end),
          ...(key ? { registrationkey: key } : {}),
        },
      },
    );
    return parseBlsSeries(body);
  }

  async beaTable({
    table,
    frequency,
    years,
  }: {
    table: string;
    frequency: 'Q' | 'M';
    years: readonly number[];
  }): Promise<BeaTable> {
    const key = this.keys.bea;
    if (!key) throw new OfficialSourceError('bea', 'not_configured');
    const url = new URL(BEA_API_URL);
    url.search = new URLSearchParams({
      UserID: key,
      method: 'GetData',
      DataSetName: 'NIPA',
      TableName: table,
      Frequency: frequency,
      Year: years.join(','),
      ResultFormat: 'JSON',
    }).toString();
    return parseBeaTable(await this.request('bea', url, {}));
  }

  async censusRetail({
    category,
    dataType,
    from,
  }: {
    category: string;
    dataType: string;
    from: string;
  }): Promise<PeriodValue[]> {
    const key = this.keys.census;
    if (!key) throw new OfficialSourceError('census', 'not_configured');
    const url = new URL(CENSUS_MARTS_URL);
    url.search = new URLSearchParams({
      get: 'cell_value,data_type_code,category_code,seasonally_adj,error_data',
      for: 'us:*',
      time: `from ${from}`,
      key,
    }).toString();
    return parseCensusRetail(await this.request('census', url, {}), {
      category,
      dataType,
    });
  }

  async weeklyClaims(year: number): Promise<ClaimsWeek[]> {
    const xml = await this.request('dol', new URL(DOL_CLAIMS_URL), {
      method: 'POST',
      as: 'text',
      form: new URLSearchParams({
        level: 'us',
        strtdate: String(year),
        enddate: String(year),
        filetype: 'xml',
        submit: 'Submit',
      }),
    });
    return parseWeeklyClaims(typeof xml === 'string' ? xml : '');
  }

  async latestClaimsRelease(): Promise<ClaimsHeadline | null> {
    const pdf = await this.request('dol', new URL(DOL_CLAIMS_RELEASE_URL), {
      as: 'bytes',
    });
    return pdf instanceof Uint8Array ? parseClaimsHeadline(pdfText(pdf)) : null;
  }

  async fomcStatement(date: string): Promise<string | null> {
    const html = await this.request(
      'frb',
      new URL(FOMC_DECISION.statementUrl(date)),
      { as: 'text', allowNotFound: true },
    );
    return typeof html === 'string' ? htmlToText(html) : null;
  }

  private async request(
    source: OfficialAgencyId,
    url: URL,
    options: RequestOptions,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.limited(() =>
        this.fetchOnce(source, url, options),
      );
      if (response.status === 404 && options.allowNotFound) return null;
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= this.maxRetries)
          throw new OfficialSourceError(
            source,
            response.status === 429 ? 'rate_limited' : 'http_error',
            response.status,
          );
        await this.sleep(backoffMs(attempt, response.retryAfter));
        continue;
      }
      // Census answers a missing, unknown or inactive key with a redirect to
      // a help page such as invalid_key.html.
      if (response.status >= 300 && response.status < 400)
        throw new OfficialSourceError(
          source,
          KEY_HELP_PAGE.test(response.location ?? '')
            ? 'key_rejected'
            : 'api_error',
          response.status,
        );
      if (response.status < 200 || response.status >= 300)
        throw new OfficialSourceError(source, 'http_error', response.status);
      if (response.body === undefined)
        throw new OfficialSourceError(
          source,
          'invalid_response',
          response.status,
        );
      return response.body;
    }
  }

  private async fetchOnce(
    source: OfficialAgencyId,
    url: URL,
    options: RequestOptions,
  ): Promise<{
    status: number;
    retryAfter?: number;
    location?: string;
    body?: unknown;
  }> {
    const headers: Record<string, string> = {
      accept:
        options.as === 'bytes'
          ? 'application/pdf'
          : options.as === 'text'
            ? 'text/html, application/xml;q=0.9, */*;q=0.8'
            : 'application/json',
    };
    let body: string | undefined;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = options.form.toString();
    }
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new OfficialSourceError(
        source,
        error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'timeout'
          : 'network',
      );
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    let parsed: unknown;
    if (response.ok) {
      try {
        parsed =
          options.as === 'bytes'
            ? new Uint8Array(await response.arrayBuffer())
            : options.as === 'text'
              ? await response.text()
              : await response.json();
      } catch {
        parsed = undefined;
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    return {
      status: response.status,
      retryAfter:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      location: response.headers.get('location') ?? undefined,
      body: parsed,
    };
  }

  /** At most `maxConcurrent` requests in flight, starts spaced by `minIntervalMs`. */
  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.maxConcurrent) this.active += 1;
    // A finishing request hands its slot straight to the next waiter.
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      const now = Date.now();
      const wait = Math.max(0, this.nextStart - now);
      this.nextStart = Math.max(now, this.nextStart) + this.minIntervalMs;
      if (wait) await this.sleep(wait);
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds) return Math.min(60_000, retryAfterSeconds * 1000);
  return Math.min(30_000, 2_000 * 2 ** attempt);
}

/** Census's key help pages: missing_key.html, invalid_key.html and the like. */
const KEY_HELP_PAGE = /_key\.html(?:$|[?#])/i;
/** "...the daily threshold for total number of requests ... has been reached." */
const BLS_DAILY_LIMIT = /\bthreshold\b/i;
/** "The key:... provided by the User is invalid." */
const BLS_KEY_REJECTED =
  /\bkey\b.*\b(?:invalid|expired|inactive|not valid|not active)\b/i;

/** BEA names the UserID in its unknown-key and inactive-key errors. */
function beaKeyRejected(error: unknown): boolean {
  const first: unknown = Array.isArray(error) ? error[0] : error;
  const description = asRecord(first).APIErrorDescription;
  return typeof description === 'string' && /userid/i.test(description);
}

/** BLS Public Data API answer: monthly periods M01-M12; M13 (annual) is skipped. */
export function parseBlsSeries(body: unknown): Map<string, PeriodValue[]> {
  const record = asRecord(body);
  if (record.status !== 'REQUEST_SUCCEEDED') {
    // BLS explains a refusal in `message`, which can quote the key, so only
    // the kind of refusal is kept.
    const message = Array.isArray(record.message)
      ? record.message.filter((part) => typeof part === 'string').join(' ')
      : '';
    throw new OfficialSourceError(
      'bls',
      typeof record.status !== 'string'
        ? 'invalid_response'
        : BLS_DAILY_LIMIT.test(message)
          ? 'rate_limited'
          : BLS_KEY_REJECTED.test(message)
            ? 'key_rejected'
            : 'api_error',
    );
  }
  const series = asRecord(record.Results).series;
  if (!Array.isArray(series))
    throw new OfficialSourceError('bls', 'invalid_response');
  const out = new Map<string, PeriodValue[]>();
  for (const item of series) {
    const row = asRecord(item);
    if (typeof row.seriesID !== 'string' || !Array.isArray(row.data)) continue;
    const values = row.data.flatMap((point): PeriodValue[] => {
      const entry = asRecord(point);
      const year = typeof entry.year === 'string' ? entry.year : '';
      const month = /^M(0[1-9]|1[0-2])$/.exec(
        typeof entry.period === 'string' ? entry.period : '',
      );
      if (!/^\d{4}$/.test(year) || !month) return [];
      return [{ period: `${year}-${month[1]}`, value: numeric(entry.value) }];
    });
    out.set(row.seriesID, sortedByPeriod(values));
  }
  return out;
}

/** BEA Data API NIPA answer. Errors arrive as HTTP 200 with an Error object. */
export function parseBeaTable(body: unknown): BeaTable {
  const api = asRecord(asRecord(body).BEAAPI);
  const rawResults = api.Results;
  const results = asRecord(
    Array.isArray(rawResults) ? (rawResults[0] as unknown) : rawResults,
  );
  const error = api.Error ?? results.Error;
  if (error !== undefined)
    throw new OfficialSourceError(
      'bea',
      beaKeyRejected(error) ? 'key_rejected' : 'api_error',
    );
  if (!Array.isArray(results.Data))
    throw new OfficialSourceError('bea', 'invalid_response');
  const rows = results.Data.flatMap((item) => {
    const row = asRecord(item);
    const period = beaPeriod(row.TimePeriod);
    if (typeof row.LineNumber !== 'string' || !period) return [];
    return [{ line: row.LineNumber, period, value: numeric(row.DataValue) }];
  });
  let lastRevised: string | null = null;
  for (const note of Array.isArray(results.Notes) ? results.Notes : []) {
    const text = asRecord(note).NoteText;
    const revised = typeof text === 'string' ? revisedDate(text) : null;
    if (revised && (!lastRevised || revised > lastRevised))
      lastRevised = revised;
  }
  return { rows, lastRevised };
}

/** BEA's machine-readable release schedule, keyed by release name. */
export function parseBeaReleaseDates(body: unknown): BeaReleaseDates {
  const record = asRecord(body);
  const dates = (name: string) => {
    const list = asRecord(record[name]).release_dates;
    if (!Array.isArray(list)) return [];
    const instants = list.flatMap((value) => {
      if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return [];
      const at = new Date(value);
      return Number.isNaN(at.getTime()) ? [] : [at.toISOString()];
    });
    return [...new Set(instants)].sort();
  };
  const gdp = dates('Gross Domestic Product');
  const personalIncomeAndOutlays = dates('Personal Income and Outlays');
  if (!gdp.length && !personalIncomeAndOutlays.length)
    throw new OfficialSourceError('bea', 'invalid_response');
  return { gdp, personalIncomeAndOutlays };
}

/** Census Data API answer: a header row, then string rows. */
export function parseCensusRetail(
  body: unknown,
  { category, dataType }: { category: string; dataType: string },
): PeriodValue[] {
  if (!Array.isArray(body) || !Array.isArray(body[0]))
    throw new OfficialSourceError('census', 'invalid_response');
  const [header, ...rows] = body as unknown[][];
  const column = (name: string) => header.indexOf(name);
  const at = {
    value: column('cell_value'),
    type: column('data_type_code'),
    category: column('category_code'),
    adjusted: column('seasonally_adj'),
    error: column('error_data'),
    time: column('time'),
  };
  if ([at.value, at.type, at.category, at.adjusted, at.time].some((i) => i < 0))
    throw new OfficialSourceError('census', 'invalid_response');
  const byPeriod = new Map<string, PeriodValue>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const period = row[at.time];
    if (
      row[at.category] !== category ||
      row[at.type] !== dataType ||
      row[at.adjusted] !== 'yes' ||
      (at.error >= 0 && row[at.error] !== 'no') ||
      typeof period !== 'string' ||
      !/^\d{4}-\d{2}$/.test(period)
    )
      continue;
    byPeriod.set(period, { period, value: numeric(row[at.value]) });
  }
  return sortedByPeriod([...byPeriod.values()]);
}

/** ETA weekly claims XML (report r539cy, national level). */
export function parseWeeklyClaims(xml: string): ClaimsWeek[] {
  if (!/<r539cyNational\b/.test(xml))
    throw new OfficialSourceError('dol', 'invalid_response');
  const weeks: ClaimsWeek[] = [];
  for (const [, block] of xml.matchAll(/<week>([\s\S]*?)<\/week>/g)) {
    const ended =
      /<weekEnded>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/weekEnded>/.exec(block);
    const initial = /<InitialClaims>([\s\S]*?)<\/InitialClaims>/.exec(block);
    const adjusted = initial ? /<SA>([\s\S]*?)<\/SA>/.exec(initial[1]) : null;
    if (!ended) continue;
    weeks.push({
      weekEnded: `${ended[3]}-${ended[1]}-${ended[2]}`,
      initialClaims: numeric(decodeEntities(adjusted?.[1] ?? '')),
    });
  }
  return weeks.sort((a, b) => a.weekEnded.localeCompare(b.weekEnded));
}

const CLAIMS_HEADLINE =
  /In the week ending ([A-Z][a-z]+)\.? (\d{1,2}), the advance figure for seasonally adjusted initial claims was ([\d,]+)/;
const CLAIMS_PREVIOUS =
  /The previous week.s level was (?:revised (?:up|down) by [\d,]+ from [\d,]+ to ([\d,]+)|unrevised at ([\d,]+))/;

/**
 * The headline of the Labor Department's weekly claims release: "In the week
 * ending November 21, the advance figure for seasonally adjusted initial
 * claims was 189,000, ... The previous week's level was revised down by
 * 1,000 from 203,000 to 202,000."
 */
export function parseClaimsHeadline(text: string): ClaimsHeadline | null {
  const plain = text.replace(/\s+/g, ' ');
  const head = CLAIMS_HEADLINE.exec(plain);
  const month = head ? MONTH_NUMBERS[head[1].slice(0, 3).toLowerCase()] : 0;
  const claims = head ? numeric(head[3]) : null;
  if (!head || !month || claims === null) return null;
  const previous = CLAIMS_PREVIOUS.exec(
    plain.slice(head.index, head.index + 800),
  );
  return {
    weekEnded: `${String(month).padStart(2, '0')}-${head[2].padStart(2, '0')}`,
    initialClaims: claims,
    previous: previous ? numeric(previous[1] ?? previous[2]) : null,
  };
}

/**
 * Rough text of a PDF: inflate each Flate stream and join the literal strings
 * its text operators show. Enough for a release's fixed headline sentence;
 * anything unreadable just yields no match.
 */
export function pdfText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binary = buffer.toString('latin1');
  const parts: string[] = [];
  const opening = /stream\r?\n/g;
  for (let match = opening.exec(binary); match; match = opening.exec(binary)) {
    const start = match.index + match[0].length;
    let end = binary.indexOf('endstream', start);
    if (end < 0) break;
    opening.lastIndex = end;
    while (
      end > start &&
      (binary[end - 1] === '\n' || binary[end - 1] === '\r')
    )
      end -= 1;
    let content: string;
    try {
      content = inflateSync(buffer.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    const strings = content.match(/\((?:\\[\s\S]|[^\\)])*\)/g);
    if (strings) parts.push(strings.map(pdfString).join(''));
  }
  return parts.join(' ');
}

const PDF_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
};

function pdfString(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(/\\([0-7]{1,3}|[\s\S])/g, (_, code: string) =>
      /^[0-7]+$/.test(code)
        ? String.fromCharCode(parseInt(code, 8))
        : (PDF_ESCAPES[code] ?? code),
    );
}

const DASHES = /[‐-―−]/g;
const DECISION =
  /decided to (maintain|raise|increase|lower|decrease|reduce) the target range for the federal funds rate(?: by ([0-9][0-9/-]*) (percentage points?|basis points))? (?:at|to) ([0-9][0-9/-]*) to ([0-9][0-9/-]*) percent/i;

/**
 * The target range from an FOMC statement, e.g. "decided to lower the target
 * range for the federal funds rate by 1/4 percentage point to 3-1/2 to 3-3/4
 * percent". Dissents ("preferred to lower ...") are not decisions.
 */
export function parseFomcDecision(text: string): FomcDecision | null {
  const match = DECISION.exec(text.replace(DASHES, '-').replace(/\s+/g, ' '));
  if (!match) return null;
  const lower = rate(match[4]);
  const upper = rate(match[5]);
  if (lower === null || upper === null || upper < lower) return null;
  const verb = match[1].toLowerCase();
  const action =
    verb === 'maintain'
      ? 'maintain'
      : verb === 'raise' || verb === 'increase'
        ? 'raise'
        : 'lower';
  let step: number | null = null;
  if (match[2]) {
    const amount = rate(match[2]);
    if (amount !== null)
      step = /basis/i.test(match[3] ?? '') ? amount / 100 : amount;
  }
  const shift =
    action === 'maintain'
      ? 0
      : step === null
        ? null
        : action === 'raise'
          ? -step
          : step;
  return {
    action,
    lower,
    upper,
    previousLower: shift === null ? null : roundHundredth(lower + shift),
    previousUpper: shift === null ? null : roundHundredth(upper + shift),
  };
}

/** "3-1/2" -> 3.5, "4" -> 4, "1/4" -> 0.25. */
function rate(text: string): number | null {
  const mixed = /^(\d+)(?:-(\d+)\/(\d+))?$/.exec(text);
  if (mixed) {
    const whole = Number(mixed[1]);
    return mixed[2] ? whole + Number(mixed[2]) / Number(mixed[3]) : whole;
  }
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : null;
}

function roundHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Visible text of an HTML page, entities decoded and whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code.startsWith('#')) {
        const point =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point < 0x110000
          ? String.fromCodePoint(point)
          : ' ';
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    },
  );
}

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const MONTH_NUMBERS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "... Last Revised on: October 29, 2026 ..." -> "2026-10-29". */
function revisedDate(text: string): string | null {
  const match =
    /last\s*revised(?:\s+on)?\s*:?\s*([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(
      text,
    );
  const month = match ? MONTH_NUMBERS[match[1].toLowerCase()] : undefined;
  if (!match || !month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

/** "2026Q3" -> "2026-Q3", "2026M10" -> "2026-10"; annual periods are skipped. */
function beaPeriod(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const quarter = /^(\d{4})Q([1-4])$/.exec(value);
  if (quarter) return `${quarter[1]}-Q${quarter[2]}`;
  const month = /^(\d{4})M(0[1-9]|1[0-2])$/.exec(value);
  return month ? `${month[1]}-${month[2]}` : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function sortedByPeriod(values: PeriodValue[]): PeriodValue[] {
  return values.sort((a, b) => a.period.localeCompare(b.period));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
