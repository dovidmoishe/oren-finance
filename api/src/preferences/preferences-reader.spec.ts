import { drizzle } from 'drizzle-orm/pg-proxy';
import type { Database } from '../database/database.provider';
import { PreferencesReader } from './preferences-reader';

describe('preference interest reader', () => {
  it('retains themes and existing sectors while discarding unknown identifiers', async () => {
    const query = jest
      .fn<Promise<{ rows: string[][][] }>, [string, unknown[]]>()
      .mockResolvedValue({
        rows: [[['artificialIntelligence', 'energy', 'obsolete-topic']]],
      });
    const reader = new PreferencesReader(drizzle(query) as unknown as Database);
    await expect(reader.getSectors('did:privy:alice')).resolves.toEqual([
      'artificialIntelligence',
      'energy',
    ]);
    expect(query.mock.calls[0][1]).toEqual(['did:privy:alice']);
  });
});
