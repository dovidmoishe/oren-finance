import {
  candidateMonths,
  countryCode,
  CountryDatabase,
  dbipCountryUrl,
  normalizeIp,
  openCountryDatabase,
  readerLookup,
} from './growth-geo';

describe('country lookup', () => {
  it('reads the ISO code from a MaxMind-compatible record and ignores placeholders', () => {
    expect(countryCode({ country: { iso_code: 'NG' } })).toBe('NG');
    expect(countryCode({ country: { iso_code: 'gb' } })).toBe('GB');
    expect(countryCode({ country: { iso_code: 'ZZ' } })).toBeNull();
    expect(countryCode({ country: { iso_code: 'USA' } })).toBeNull();
    expect(countryCode({ continent: { code: 'EU' } })).toBeNull();
    expect(countryCode(null)).toBeNull();
  });

  it('accepts only real addresses and strips brackets and zones', () => {
    expect(normalizeIp('41.58.0.1')).toBe('41.58.0.1');
    expect(normalizeIp('::ffff:8.8.8.8')).toBe('::ffff:8.8.8.8');
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp('unknown')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });

  it('returns null instead of throwing for bad input or a failing reader', () => {
    const get = jest.fn((ip: string) =>
      ip === '41.58.0.1' ? { country: { iso_code: 'NG' } } : null,
    );
    const lookup = readerLookup({ get });
    expect(lookup('41.58.0.1')).toBe('NG');
    expect(lookup('10.0.0.1')).toBeNull();
    expect(lookup('not an address')).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    const broken = readerLookup({
      get: () => {
        throw new Error('corrupt');
      },
    });
    expect(broken('41.58.0.1')).toBeNull();
  });

  it('refuses a file that is not a country database', () => {
    expect(() => openCountryDatabase(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

const href = (input: string | URL | Request) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

describe('DB-IP monthly database', () => {
  const lookup = () => 'NG';
  const ok = () => new Response(new Uint8Array([1]), { status: 200 });
  const missing = () => new Response(null, { status: 404 });
  const logger = { log: jest.fn(), warn: jest.fn() };

  function database(
    now: Date,
    respond: (url: string) => Response | Promise<Response>,
    open = jest.fn(() => lookup),
  ) {
    const fetch = jest.fn((input: string | URL | Request) =>
      Promise.resolve(respond(href(input))),
    ) as unknown as jest.MockedFunction<typeof globalThis.fetch>;
    return {
      fetch,
      open,
      db: new CountryDatabase({ fetch, now: () => now, logger, open }),
    };
  }

  it('names this month and last month, across a year boundary', () => {
    expect(candidateMonths(new Date('2026-01-03T00:00:00Z'))).toEqual([
      '2026-01',
      '2025-12',
    ]);
    expect(dbipCountryUrl('2026-11')).toBe(
      'https://download.db-ip.com/free/dbip-country-lite-2026-11.mmdb.gz',
    );
  });

  it('uses last month until this month is published, then switches', async () => {
    const now = { value: new Date('2026-12-01T06:00:00Z') };
    let published = false;
    const fetch = jest.fn((input: string | URL | Request) => {
      const url = href(input);
      return Promise.resolve(
        url.includes('2026-12') && !published ? missing() : ok(),
      );
    }) as unknown as typeof globalThis.fetch;
    const db = new CountryDatabase({
      fetch,
      now: () => now.value,
      logger,
      open: () => lookup,
    });

    expect(db.lookup('41.58.0.1')).toBeNull();
    await expect(db.refresh()).resolves.toBe(true);
    expect(db.version).toBe('2026-11');
    expect(db.lookup('41.58.0.1')).toBe('NG');

    // Still unpublished: no second download of November.
    await db.refresh();
    expect(fetch).toHaveBeenCalledTimes(3);

    published = true;
    await db.refresh();
    expect(db.version).toBe('2026-12');

    // Current month already loaded: nothing to fetch.
    await db.refresh();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps the database in use when a download or parse fails', async () => {
    const first = database(new Date('2026-11-20T00:00:00Z'), ok);
    await first.db.refresh();
    expect(first.db.version).toBe('2026-11');

    const failing = new CountryDatabase({
      fetch: jest.fn(() => Promise.reject(new Error('offline'))),
      now: () => new Date('2026-12-05T00:00:00Z'),
      logger,
      open: () => lookup,
    });
    await expect(failing.refresh()).resolves.toBe(false);
    expect(failing.lookup('41.58.0.1')).toBeNull();

    failing.use(lookup, '2026-11');
    await expect(failing.refresh()).resolves.toBe(true);
    expect(failing.version).toBe('2026-11');
    expect(failing.lookup('41.58.0.1')).toBe('NG');

    const corrupt = database(
      new Date('2026-11-20T00:00:00Z'),
      ok,
      jest.fn(() => {
        throw new Error('not a country database');
      }),
    );
    await expect(corrupt.db.refresh()).resolves.toBe(false);
    expect(corrupt.db.version).toBeNull();
  });

  it('rejects a response that announces more than the size limit', async () => {
    const huge = database(
      new Date('2026-11-20T00:00:00Z'),
      () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-length': String(200 * 1024 * 1024) },
        }),
    );
    await expect(huge.db.refresh()).resolves.toBe(false);
    expect(huge.open).not.toHaveBeenCalled();
  });
});
