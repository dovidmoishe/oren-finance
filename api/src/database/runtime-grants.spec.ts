import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const migrationsDir = resolve(process.cwd(), 'lib/db/migrations');
const appTablesFrom = '0017_';

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(resolve(migrationsDir, name), 'utf8'),
    }));
}

function tablesCreated(sql: string) {
  return [
    ...sql.matchAll(/create table(?: if not exists)?\s+"?([a-z0-9_]+)"?/gi),
  ].map((match) => match[1]);
}

function hasExplicitSiud(table: string, files: { sql: string }[]) {
  const grant = new RegExp(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON(?: TABLE)? (?:public\\.)?"?${table}"? TO oren_api_runtime`,
    'i',
  );
  if (files.some((file) => grant.test(file.sql))) return true;
  const defaults = files.find((file) =>
    file.sql.includes('ALTER DEFAULT PRIVILEGES FOR ROLE oren'),
  );
  return Boolean(
    defaults &&
    defaults.sql.includes(`'${table}'`) &&
    defaults.sql.includes(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO oren_api_runtime',
    ),
  );
}

describe('runtime table grants', () => {
  const files = migrationFiles();
  const defaultsAt = files.findIndex((file) =>
    file.sql.includes('ALTER DEFAULT PRIVILEGES FOR ROLE oren'),
  );

  it('grants existing notification tables and future tables owned by oren', () => {
    expect(defaultsAt).toBeGreaterThan(-1);
    const defaults = files[defaultsAt].sql;
    expect(defaults).toContain("rolname = 'oren_api_runtime'");
    expect(defaults).toContain("rolname = 'oren'");
    expect(defaults).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oren_api_runtime',
    );
    expect(defaults).toContain(
      'GRANT USAGE, SELECT ON SEQUENCES TO oren_api_runtime',
    );
    expect(defaults).not.toMatch(/^\s*(?:EXECUTE\s+)?'?GRANT[^;\n]*TRUNCATE/im);
    for (const table of [
      'notification_jobs',
      'price_alerts',
      'notification_budgets',
      'price_poll_cursor',
      'brief_valuations',
      'user_preferences',
    ]) {
      expect(hasExplicitSiud(table, files)).toBe(true);
    }
    const postProvision = files.findIndex((file) =>
      file.name.startsWith(appTablesFrom),
    );
    expect(postProvision).toBeGreaterThan(-1);
    for (const [index, file] of files.entries()) {
      if (index < postProvision || index > defaultsAt) continue;
      for (const table of tablesCreated(file.sql)) {
        expect(hasExplicitSiud(table, files)).toBe(true);
      }
    }
    const roles = readFileSync(
      resolve(process.cwd(), '../infra/signer-gate/roles.sql'),
      'utf8',
    );
    expect(roles).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oren_api_runtime',
    );
    expect(roles).toContain(
      'GRANT USAGE, SELECT ON SEQUENCES TO oren_api_runtime',
    );
    expect(roles).not.toMatch(/ALTER DEFAULT PRIVILEGES[^;]*TRUNCATE/i);
  });
});

const pgUrl = process.env.MCP_TEST_POSTGRES_URL;
const live = pgUrl ? describe : describe.skip;

live('runtime grants against disposable Postgres', () => {
  let admin: ReturnType<typeof postgres>;
  const created = { oren: false, runtime: false };
  const probe = `runtime_grant_probe_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    if (
      !pgUrl ||
      !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1):\d+\/oren_mcp_test(?:\?|$)/.test(
        pgUrl,
      )
    ) {
      throw new Error(
        'MCP_TEST_POSTGRES_URL must target the local oren_mcp_test database',
      );
    }
    admin = postgres(pgUrl, { max: 1 });
    const db = drizzle(admin);
    await migrate(db, { migrationsFolder: migrationsDir });
  }, 90_000);

  afterAll(async () => {
    if (!admin) return;
    await admin`reset role`;
    if (/^runtime_grant_probe_[0-9a-f]+$/.test(probe)) {
      await admin.unsafe(`drop table if exists public.${probe}`);
    }
    if (created.oren) {
      await admin.unsafe(`
        alter default privileges for role oren in schema public
          revoke select, insert, update, delete on tables from oren_api_runtime;
        alter default privileges for role oren in schema public
          revoke usage, select on sequences from oren_api_runtime;
        revoke all privileges on schema public from oren;
        drop owned by oren;
        drop role oren;
      `);
    }
    if (created.runtime) {
      await admin.unsafe(`
        revoke all privileges on all tables in schema public from oren_api_runtime;
        revoke all privileges on all sequences in schema public from oren_api_runtime;
        revoke all privileges on schema public from oren_api_runtime;
        drop owned by oren_api_runtime;
        drop role oren_api_runtime;
      `);
    }
    await admin.end({ timeout: 5 });
  });

  it('lets oren_api_runtime write new tables without truncate', async () => {
    const existing = await admin`
      select rolname from pg_roles where rolname in ('oren', 'oren_api_runtime')`;
    const present = new Set(existing.map((row) => row.rolname));
    if (!present.has('oren')) {
      await admin.unsafe('create role oren nologin');
      created.oren = true;
    }
    if (!present.has('oren_api_runtime')) {
      await admin.unsafe('create role oren_api_runtime nologin nosuperuser');
      created.runtime = true;
    }
    const grantSql = readFileSync(
      resolve(migrationsDir, '0021_runtime_table_grants.sql'),
      'utf8',
    );
    for (const statement of grantSql.split('--> statement-breakpoint')) {
      const sqlText = statement.trim();
      if (sqlText) await admin.unsafe(sqlText);
    }
    await admin.unsafe('grant usage, create on schema public to oren');
    await admin.unsafe('set role oren');
    await admin.unsafe(
      `create table public.${probe} (id integer generated by default as identity primary key, note text)`,
    );
    await admin.unsafe('reset role');
    if (!/^runtime_grant_probe_[0-9a-f]+$/.test(probe)) {
      throw new Error('Unsafe probe table name');
    }
    const [privileges] = await admin.unsafe(`
      select has_table_privilege('oren_api_runtime', 'public.${probe}', 'SELECT') as sel,
        has_table_privilege('oren_api_runtime', 'public.${probe}', 'INSERT') as ins,
        has_table_privilege('oren_api_runtime', 'public.${probe}', 'UPDATE') as upd,
        has_table_privilege('oren_api_runtime', 'public.${probe}', 'DELETE') as del,
        has_table_privilege('oren_api_runtime', 'public.${probe}', 'TRUNCATE') as trunc,
        has_sequence_privilege(
          'oren_api_runtime',
          pg_get_serial_sequence('public.${probe}', 'id'),
          'USAGE'
        ) as seq`);
    expect(privileges).toEqual({
      sel: true,
      ins: true,
      upd: true,
      del: true,
      trunc: false,
      seq: true,
    });
    const tables = await admin.unsafe(`
      select c.relname,
        has_table_privilege('oren_api_runtime', c.oid, 'SELECT')
          and has_table_privilege('oren_api_runtime', c.oid, 'INSERT')
          and has_table_privilege('oren_api_runtime', c.oid, 'UPDATE')
          and has_table_privilege('oren_api_runtime', c.oid, 'DELETE')
          and not has_table_privilege('oren_api_runtime', c.oid, 'TRUNCATE') as ok
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in (
          'notification_jobs', 'price_alerts', 'notification_budgets',
          'price_poll_cursor', 'brief_valuations', 'user_preferences'
        )`);
    expect(tables.map((row) => row.relname).sort()).toEqual([
      'brief_valuations',
      'notification_budgets',
      'notification_jobs',
      'price_alerts',
      'price_poll_cursor',
      'user_preferences',
    ]);
    expect(tables.every((row) => row.ok)).toBe(true);
  }, 30_000);
});
