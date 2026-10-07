import {
  creationPayload,
  hashPayload,
  publicHttps,
  termsIssues,
  validTimezone,
} from './creation.validation';
import { emptyCreationTerms } from './creation-research.service';
import {
  parseManifest,
  CreationTransactionService,
} from './creation-transaction.service';
import {
  CreationArtworkService,
  canonicalLogo,
  publicAddress,
} from './creation-artwork.service';
import sharp from 'sharp';
import { validateEnv } from '../../config/env.schema';
export function fixtureTerms() {
  return {
    ...emptyCreationTerms('Will official GDP rise?', 'Africa/Lagos'),
    resolutionRule:
      'YES if the first published GDP growth is greater than 2 percent; otherwise NO.',
    measurement: 'Official GDP growth, percent, first release.',
    observationPolicy:
      'First published official release on 2026-12-01 at 08:30 America/New_York.',
    missingDataPolicy: 'Cancel if the official observation is missing.',
    sourcesOfTruth: ['https://www.bea.gov/data/gdp/gross-domestic-product'],
  };
}
describe('Creation rules and artwork', () => {
  it('defaults publication off and rejects invalid or isolated publication configuration', () => {
    const base = {
      POSTGRES_URL: 'postgres://test',
      TOKENS_API_KEY: 'test',
      ALCHEMY_API_KEY: 'test',
    };
    expect(validateEnv(base).PANTA_CREATION_ENABLED).toBe(false);
    expect(() =>
      validateEnv({ ...base, PANTA_CREATION_ENABLED: 'true' }),
    ).toThrow('PANTA_ENABLED');
    expect(() =>
      validateEnv({ ...base, PANTA_CREATION_RPC_URL: 'file:///secret' }),
    ).toThrow('Invalid PANTA_CREATION_RPC_URL');
  });
  it('keeps timezone, exact provider fields, integer dates and approval hashes', () => {
    const terms = fixtureTerms();
    expect(termsIssues(terms)).toEqual([]);
    expect(validTimezone('Not/AZone')).toBe(false);
    expect(termsIssues({ ...terms, startTime: terms.endTime })).toContain(
      'Require start < end <= resolution as Unix seconds.',
    );
    const payload = creationPayload(
      'wallet',
      terms,
      'https://res.cloudinary.com/preview.png',
    );
    expect(payload).not.toHaveProperty('assetIds');
    expect(payload.resolutionRule).toContain('Exact tie: NO');
    expect(payload.resolutionRule).toContain('Africa/Lagos');
    expect(hashPayload({ payload, artworkHash: '1' })).not.toEqual(
      hashPayload({ payload, artworkHash: '2' }),
    );
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
  it('blocks ambiguous versus rules, duplicate assets and missing observations', () => {
    const terms = {
      ...fixtureTerms(),
      template: 'stock_versus' as const,
      category: 'finance' as const,
      assetIds: ['nvda', 'nvda'],
    };
    expect(termsIssues(terms)).toEqual(
      expect.arrayContaining([
        'Versus markets require two distinct canonical stocks.',
        'Specify percentage returns, exact sessions, split adjustments and dividend exclusion.',
      ]),
    );
    expect(termsIssues({ ...terms, missingDataPolicy: '' })).toContain(
      'Provide valid missingDataPolicy (maximum 600 characters).',
    );
    expect(termsIssues({ ...terms, tiePolicy: 'YES' as never })).toContain(
      'Only standard, Global markets with ties resolving NO are supported.',
    );
  });
  it('fails closed without an audited creation contract', () => {
    expect(parseManifest('{}')).toBeNull();
    expect(parseManifest('bad')).toBeNull();
    expect(
      new CreationTransactionService({
        PANTA_CREATION_ENABLED: false,
      } as never).blockers(),
    ).toHaveLength(3);
  });
  it('rejects local/logo credentials and provides deterministic square neutral previews', async () => {
    for (const url of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://127.0.0.1/logo',
      'https://private.internal/logo',
    ]) {
      expect(publicHttps(url)).toBe(false);
      await expect(canonicalLogo(url)).rejects.toThrow();
    }
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '100.64.0.1',
      '::1',
    ])
      expect(publicAddress(ip)).toBe(false);
    const service = new CreationArtworkService({
      getStock: jest.fn().mockRejectedValue(new Error('unavailable')),
    } as never);
    const terms = { ...fixtureTerms(), assetIds: ['nvda', 'aapl'] };
    const first = await service.render(terms),
      second = await service.render(terms);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.warnings).toHaveLength(1);
    const metadata = await sharp(
      Buffer.from(first.previewDataUrl.split(',')[1], 'base64'),
    ).metadata();
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
  });
});
