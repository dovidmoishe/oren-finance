import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { AtaRentSponsorRepository } from './ata-rent-sponsor.repository';

// A serialized transactional store executes the repository's query decisions; SQL is
// inspected as well so removing the cross-process lock cannot make this test pass.
function fixture() {
  type Row = {
    id: string;
    userId: string;
    wallet: string;
    mint: string;
    lamports: string;
    status: string;
  };
  const rows: Row[] = [];
  const statements: string[] = [];
  const dialect = new PgDialect();
  const query = (value: SQL) => dialect.sqlToQuery(value);
  let tail = Promise.resolve();
  const db = {
    transaction: jest.fn((run: (tx: unknown) => Promise<unknown>) => {
      const work = tail.then(() =>
        run({
          execute: (sql: SQL) => {
            statements.push(query(sql).sql);
            return Promise.resolve([]);
          },
          select: (fields: Record<string, SQL>) => ({
            from: () => {
              if ('id' in fields)
                return {
                  where: (condition: SQL) => ({
                    limit: () => {
                      const [wallet, mint] = query(condition).params;
                      return Promise.resolve(
                        rows.filter(
                          (row) => row.wallet === wallet && row.mint === mint,
                        ),
                      );
                    },
                  }),
                };
              const userId = query(fields.count).params[0];
              return Promise.resolve([
                {
                  count: String(
                    rows.filter((row) => row.userId === userId).length,
                  ),
                  spent: String(
                    rows.reduce((sum, row) => sum + BigInt(row.lamports), 0n),
                  ),
                },
              ]);
            },
          }),
          insert: () => ({
            values: (input: Omit<Row, 'id' | 'status'>) => ({
              onConflictDoNothing: () => ({
                returning: () => {
                  if (
                    rows.some(
                      (row) =>
                        row.wallet === input.wallet && row.mint === input.mint,
                    )
                  )
                    return Promise.resolve([]);
                  const row = {
                    ...input,
                    id: String(rows.length + 1),
                    status: 'reserved',
                  };
                  rows.push(row);
                  return Promise.resolve([row]);
                },
              }),
            }),
          }),
        }),
      );
      tail = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    }),
  };
  return {
    repository: new AtaRentSponsorRepository(db as never),
    rows,
    statements,
    db,
  };
}
const input = {
  userId: 'user',
  wallet: 'wallet',
  mint: 'mint',
  lamports: 2_000_000n,
  perUserCap: 5,
  dailyBudgetLamports: 10_000_000n,
};
describe('ATA reservation admission', () => {
  it('atomically admits only one identical pair across concurrent requests', async () => {
    const f = fixture();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => f.repository.reserve(input)),
    );
    expect(results.filter((result) => 'row' in result)).toHaveLength(1);
    expect(f.rows).toHaveLength(1);
    expect(f.statements[0]).toContain('lock_timeout');
    expect(f.statements[2]).toContain('pg_advisory_xact_lock(1635017074, 1)');
  });
  it('limits parallel requests for different mints to the lifetime cap', async () => {
    const f = fixture();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        f.repository.reserve({
          ...input,
          mint: 'mint-' + i,
          dailyBudgetLamports: 100_000_000n,
        }),
      ),
    );
    expect(results.filter((result) => 'row' in result)).toHaveLength(5);
    expect(
      results.filter(
        (result) => 'reason' in result && result.reason === 'per_user_cap',
      ),
    ).toHaveLength(5);
  });
  it('serializes the global budget across different users and wallets', async () => {
    const f = fixture();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        f.repository.reserve({
          ...input,
          userId: 'user-' + i,
          wallet: 'wallet-' + i,
        }),
      ),
    );
    expect(results.filter((result) => 'row' in result)).toHaveLength(5);
    expect(
      results.filter(
        (result) => 'reason' in result && result.reason === 'daily_budget',
      ),
    ).toHaveLength(5);
  });
  it.each(['reserved', 'sponsored', 'failed'])(
    'never reuses a %s pair after account close or restart',
    async (status) => {
      const f = fixture();
      f.rows.push({
        ...input,
        lamports: String(input.lamports),
        id: 'old',
        status,
      });
      expect(await f.repository.reserve(input)).toEqual({
        reason: 'previous_attempt',
      });
    },
  );
  it('retains failed attempts in budget and cap accounting', async () => {
    const f = fixture();
    f.rows.push({
      ...input,
      mint: 'old-mint',
      lamports: '10000000',
      id: 'old',
      status: 'failed',
    });
    expect(await f.repository.reserve(input)).toEqual({
      reason: 'daily_budget',
    });
    expect(await f.repository.reserve({ ...input, perUserCap: 1 })).toEqual({
      reason: 'per_user_cap',
    });
    expect(f.statements.join('\n')).toContain('stale_reservation');
    expect(f.statements.join('\n')).not.toMatch(/DELETE/i);
  });
});
