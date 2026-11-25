import { isIP } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { Reader } from 'mmdb-lib';

/**
 * Country of a visitor's address at request time: an ISO 3166-1 alpha-2 code, or
 * null. Only the code is stored. The address itself never leaves the request.
 */
export type CountryLookup = (ip: string | null | undefined) => string | null;

export const NO_COUNTRY: CountryLookup = () => null;

const MAX_DATABASE_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** A MaxMind-compatible country record. DB-IP Lite uses the same layout. */
export function countryCode(record: unknown): string | null {
  const iso = (
    record as { country?: { iso_code?: unknown } } | null | undefined
  )?.country?.iso_code;
  if (typeof iso !== 'string') return null;
  const code = iso.toUpperCase();
  // ZZ and XX are "unknown" placeholders in some databases.
  return /^[A-Z]{2}$/.test(code) && code !== 'ZZ' && code !== 'XX'
    ? code
    : null;
}

/** A bare IPv4 or IPv6 address, without brackets or an interface zone. */
export function normalizeIp(value: string | null | undefined): string | null {
  const ip = value
    ?.trim()
    .replace(/^\[(.*)\]$/, '$1')
    .split('%')[0];
  return ip && isIP(ip) ? ip : null;
}

export function readerLookup(reader: {
  get(ip: string): unknown;
}): CountryLookup {
  return (value) => {
    const ip = normalizeIp(value);
    if (!ip) return null;
    try {
      return countryCode(reader.get(ip));
    } catch {
      return null;
    }
  };
}

/** Parses a database, gzipped or not, and checks that it answers before it is used. */
export function openCountryDatabase(bytes: Uint8Array): CountryLookup {
  if (bytes.byteLength > MAX_DATABASE_BYTES)
    throw new Error('database is too large');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw =
    buffer[0] === 0x1f && buffer[1] === 0x8b
      ? gunzipSync(buffer, { maxOutputLength: MAX_DATABASE_BYTES })
      : buffer;
  const reader = new Reader(raw);
  if (!/country/i.test(reader.metadata.databaseType))
    throw new Error('not a country database');
  const lookup = readerLookup(reader);
  if (!lookup('8.8.8.8')) throw new Error('database did not resolve 8.8.8.8');
  return lookup;
}

/** DB-IP publishes the free country database once a month under this name. */
export function dbipCountryUrl(month: string): string {
  return `https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`;
}

/** This month first, then last month for the days before the new file appears. */
export function candidateMonths(now: Date): string[] {
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  return [now.toISOString().slice(0, 7), previous.toISOString().slice(0, 7)];
}

type Logger = { log(message: string): void; warn(message: string): void };

/** The country database in memory. A failed download keeps the previous one. */
export class CountryDatabase {
  private current: CountryLookup = NO_COUNTRY;
  private loaded: string | null = null;

  constructor(
    private readonly deps: {
      fetch: typeof fetch;
      now: () => Date;
      logger: Logger;
      open?: (bytes: Uint8Array) => CountryLookup;
    },
  ) {}

  readonly lookup: CountryLookup = (ip) => this.current(ip);

  /** The month of the database in use, or the file it came from. Null before the first load. */
  get version(): string | null {
    return this.loaded;
  }

  use(lookup: CountryLookup, version: string): void {
    this.current = lookup;
    this.loaded = version;
  }

  /** Loads this month's database when it is newer than the one in memory. True when one is in use. */
  async refresh(): Promise<boolean> {
    for (const month of candidateMonths(this.deps.now())) {
      if (this.loaded && month <= this.loaded) break;
      try {
        const response = await this.deps.fetch(dbipCountryUrl(month), {
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        // DB-IP publishes during the first days of a month.
        if (response.status === 404) continue;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > MAX_DATABASE_BYTES)
          throw new Error('database is too large');
        const open = this.deps.open ?? openCountryDatabase;
        this.use(open(new Uint8Array(await response.arrayBuffer())), month);
        this.deps.logger.log(`Loaded the DB-IP country database for ${month}`);
        break;
      } catch (error) {
        this.deps.logger.warn(
          `DB-IP country database for ${month} was not loaded: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    return this.loaded !== null;
  }
}
