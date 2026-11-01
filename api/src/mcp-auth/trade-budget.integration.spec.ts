import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import type { Database } from '../database/database.provider';
import {
  mcpBudgetReservations,
  mcpConnections,
  mcpTradeDelegations,
  mcpTradeIntents,
} from '../database/schema';
import { reserveTradeBudget, settleTradeBudget } from './trade-budget';

const url = process.env.MCP_TEST_POSTGRES_URL;
const describeDatabase = url ? describe : describe.skip;

describeDatabase('MCP budget reservations in Postgres', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;

  beforeAll(async () => {
    if (
      !url ||
      !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1):\d+\/oren_mcp_test(?:\?|$)/.test(
        url,
      )
    )
      throw new Error(
        'MCP_TEST_POSTGRES_URL must target the local oren_mcp_test database',
      );
    client = postgres(url, { max: 20 });
    db = drizzle(client) as Database;
    await migrate(db, {
      migrationsFolder: resolve(process.cwd(), 'lib/db/migrations'),
    });
  }, 90_000);

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  async function fixture(amountUsd = '10.000000') {
    const userId = `test-${randomUUID()}`;
    const walletId = `wallet-${randomUUID()}`;
    const wallet = `address-${randomUUID()}`;
    const grantId = `grant-${randomUUID()}`;
    const clientId = `client-${randomUUID()}`;
    const activatedAt = new Date(Date.now() - 60_000);
    const [delegation] = await db
      .insert(mcpTradeDelegations)
      .values({
        userId,
        walletId,
        wallet,
        status: 'active',
        signerId: 'signer-test',
        policyId: 'policy-test',
        policyHash: 'test-hash',
        policyTier: 2,
        perTradeLimitUsd: '25.000000',
        dailyLimitUsd: '50.000000',
        maxSlippageBps: 50,
        allowSell: true,
        activatedAt,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: mcpTradeDelegations.id });
    await db.insert(mcpConnections).values({
      grantId,
      clientId,
      userId,
      walletId,
      wallet,
      scopes: 'oren.read oren.trade.prepare oren.trade.execute',
      createdAt: new Date(Date.now() - 30_000),
    });
    async function intent() {
      const [row] = await db
        .insert(mcpTradeIntents)
        .values({
          grantId,
          clientId,
          userId,
          wallet,
          assetId: 'test-stock',
          ticker: 'TEST',
          side: 'buy',
          stockMint: 'test-mint',
          amountUsd,
          maxInRaw: '10000000',
          minOutRaw: '1',
          slippageBps: 50,
          mode: 'delegated',
          delegationId: delegation.id,
          expiresAt: new Date(Date.now() + 300_000),
        })
        .returning({ id: mcpTradeIntents.id });
      return row.id;
    }
    return {
      delegationId: delegation.id,
      grantId,
      clientId,
      userId,
      walletId,
      wallet,
      intent,
    };
  }

  it('allows exactly five simultaneous $10 reservations against a $50 rolling cap', async () => {
    const owner = await fixture();
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => owner.intent()),
    );
    const results = await Promise.all(
      ids.map((intentId) =>
        reserveTradeBudget(db, {
          ...owner,
          intentId,
          rawInput: '10000000',
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'reserved'),
    ).toHaveLength(5);
    expect(
      results.filter((result) => result.status === 'over_budget'),
    ).toHaveLength(15);
  }, 90_000);

  it('returns an existing reservation for the same key and releases only a definite failure', async () => {
    const owner = await fixture('25.000000');
    const intentId = await owner.intent();
    const idempotencyKey = randomUUID();
    const input = { ...owner, intentId, rawInput: '10000000', idempotencyKey };
    expect((await reserveTradeBudget(db, input)).status).toBe('reserved');
    expect((await reserveTradeBudget(db, input)).status).toBe('existing');
    expect(
      (await reserveTradeBudget(db, { ...input, idempotencyKey: randomUUID() }))
        .status,
    ).toBe('conflict');
    const secondId = await owner.intent();
    expect(
      (
        await reserveTradeBudget(db, {
          ...input,
          intentId: secondId,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe('reserved');
    const thirdId = await owner.intent();
    expect(
      (
        await reserveTradeBudget(db, {
          ...input,
          intentId: thirdId,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe('over_budget');
    await settleTradeBudget(db, intentId, 'definite_failure');
    expect(
      (
        await reserveTradeBudget(db, {
          ...input,
          intentId: thirdId,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe('reserved');
    await settleTradeBudget(db, secondId, 'confirmed');
  }, 90_000);

  it('refuses revoked grants and delegations before reserving', async () => {
    const owner = await fixture();
    const input = {
      ...owner,
      intentId: await owner.intent(),
      rawInput: '10000000',
      idempotencyKey: randomUUID(),
    };
    await db
      .update(mcpConnections)
      .set({ revokedAt: new Date() })
      .where(eq(mcpConnections.grantId, owner.grantId));
    expect((await reserveTradeBudget(db, input)).status).toBe('inactive');
    const fresh = await fixture();
    await db
      .update(mcpTradeDelegations)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(mcpTradeDelegations.id, fresh.delegationId));
    expect(
      (
        await reserveTradeBudget(db, {
          ...fresh,
          intentId: await fresh.intent(),
          rawInput: '10000000',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe('inactive');
  }, 90_000);

  it('keeps unresolved reservations charged after the rolling window', async () => {
    const owner = await fixture('25.000000');
    const firstId = await owner.intent();
    expect(
      (
        await reserveTradeBudget(db, {
          ...owner,
          intentId: firstId,
          rawInput: '10000000',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe('reserved');
    await db
      .update(mcpBudgetReservations)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
      .where(eq(mcpBudgetReservations.intentId, firstId));
    const secondId = await owner.intent();
    expect(
      (
        await reserveTradeBudget(db, {
          ...owner,
          intentId: secondId,
          rawInput: '10000000',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe('reserved');
    const thirdId = await owner.intent();
    expect(
      (
        await reserveTradeBudget(db, {
          ...owner,
          intentId: thirdId,
          rawInput: '10000000',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe('over_budget');
  }, 90_000);
});
