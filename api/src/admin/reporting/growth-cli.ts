import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { manualDatabaseAllowed } from './growth-access';
import { newMachineToken, tokenHash } from './growth-privacy';
import {
  caddyLineToPageview,
  type CaddyEvent,
  type PageviewDraft,
} from './growth-collect';
import {
  CountryDatabase,
  openCountryDatabase,
  type CountryLookup,
} from './growth-geo';
import {
  contentHash,
  recoveryToImport,
  validateImport,
  type GrowthImportDocument,
} from './growth-import';
import { hashPassword, temporaryPassword } from '../auth/admin-password';
import { bootstrapPermissions, normalizeEmail } from '../auth/admin-policy';

const invoked = process.argv[1]?.includes('growth-cli');

if (invoked) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'growth command failed',
    );
    process.exitCode = 1;
  });
}

async function main() {
  const [command, sub] = process.argv.slice(2);
  const apply = process.argv.includes('--apply');
  const allowProduction = process.argv.includes('--allow-production');
  if (!process.argv.includes('--manual')) {
    throw new Error('Pass --manual. Deploy does not run this command.');
  }
  const url = process.env.POSTGRES_URL ?? '';
  manualDatabaseAllowed({
    postgresUrl: url,
    deploymentEnv: process.env.DEPLOYMENT_ENV,
    allowProduction,
  });
  if (command === 'import' && sub === 'recovery')
    return importRecovery(url, apply);
  if (command === 'import' && sub === 'file') return importFile(url, apply);
  if (command === 'caddy') return inspectCaddy(url, apply);
  if (command === 'access') return access(url, apply);
  if (command === 'admin' && (sub === 'bootstrap' || sub === 'recover')) {
    return adminAccount(url, apply, sub);
  }
  throw new Error(
    'Use import recovery|file, caddy, access issue|revoke, or admin bootstrap|recover',
  );
}

async function importRecovery(url: string, apply: boolean) {
  const file = argument('--file');
  const document = recoveryToImport(
    JSON.parse(readFileSync(file, 'utf8')) as unknown,
  );
  await writeImport(url, document, apply);
}

async function importFile(url: string, apply: boolean) {
  const document = JSON.parse(
    readFileSync(argument('--file'), 'utf8'),
  ) as GrowthImportDocument;
  validateImport(document);
  await writeImport(url, document, apply);
}

async function writeImport(
  url: string,
  document: GrowthImportDocument,
  apply: boolean,
) {
  const hash = contentHash(document);
  console.log(
    JSON.stringify({
      status: apply ? 'apply' : 'dry-run',
      observations: document.observations.length,
      fabricatedVisits: 0,
      hash,
    }),
  );
  if (!apply) return;
  const sql = postgres(url, { max: 1 });
  try {
    const existing =
      await sql`select id from growth_import_batches where content_hash = ${hash}`;
    if (existing.length > 0) {
      console.log(JSON.stringify({ status: 'duplicate' }));
      return;
    }
    await sql.begin(async (tx) => {
      const [batch] = (await tx`
        insert into growth_import_batches
          (schema_version, source_system, provenance, verification, content_hash, timezone)
        values (
          ${document.schema}, ${document.source.system}, ${document.source.provenance},
          ${document.source.verification}, ${hash}, ${document.timezone}
        )
        returning id
      `) as Array<{ id: string }>;
      for (const item of document.observations) {
        await tx`
          insert into growth_import_observations (
            batch_id, snapshot_id, metric, family, grain, period_start, period_end, day,
            value, coverage, usable_in_totals, usable_as_window, dimensions, notes
          ) values (
            ${batch.id}, ${item.snapshotId}, ${item.metric}, ${item.family}, ${item.grain},
            ${item.periodStart}, ${item.periodEnd}, ${item.day}, ${item.value},
            ${item.coverage}, ${item.usableInTotals}, ${item.usableAsWindow},
            ${JSON.stringify(item.dimensions)}::jsonb, ${item.notes}
          )
        `;
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function inspectCaddy(url: string, apply: boolean) {
  const lines = readFileSync(argument('--file'), 'utf8')
    .split('\n')
    .filter(Boolean);
  const pepper = process.env.GROWTH_HASH_KEY || 'oren-growth-unset-pepper';
  const countryOf = await importCountries();
  const accepted: PageviewDraft[] = [];
  for (const line of lines) {
    try {
      const draft = caddyLineToPageview(
        JSON.parse(line) as CaddyEvent,
        pepper,
        'Africa/Lagos',
        countryOf,
      );
      if (draft) accepted.push(draft);
    } catch {
      // Skip a corrupt line. Do not invent a zero for it.
    }
  }
  console.log(
    JSON.stringify({
      lines: lines.length,
      pageviews: accepted.length,
      withCountry: accepted.filter((draft) => draft.country).length,
      apply,
    }),
  );
  if (!apply) return;
  const sql = postgres(url, { max: 1 });
  try {
    for (const draft of accepted) {
      // A repeat import fills in the country of a row that was imported without one.
      await sql`
        insert into growth_pageviews (
          occurred_at, path, visitor_hash, session_hash, visitor_stability, source, ingest_key,
          referrer_host, country
        ) values (
          ${draft.occurredAt}, ${draft.path}, ${draft.visitorHash}, ${draft.sessionHash},
          ${draft.visitorStability}, ${draft.source}, ${draft.ingestKey}, ${draft.referrerHost},
          ${draft.country}
        )
        on conflict (ingest_key) do update set country = excluded.country
          where growth_pageviews.country is null and excluded.country is not null
      `;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The collector's country source: GROWTH_GEOIP_DB_PATH, or this month's DB-IP Lite. */
async function importCountries(): Promise<CountryLookup> {
  const path = process.env.GROWTH_GEOIP_DB_PATH;
  if (path) return openCountryDatabase(readFileSync(path));
  const log = (message: string) => console.error(message);
  const database = new CountryDatabase({
    fetch,
    now: () => new Date(),
    logger: { log, warn: log },
  });
  // Without a database the import still runs; its rows have no country.
  await database.refresh();
  return database.lookup;
}

async function access(url: string, apply: boolean) {
  const action = process.argv[3];
  if (
    process.argv.includes('--user') ||
    process.argv.includes('--permission')
  ) {
    throw new Error(
      'Report access is only the marketing bot bearer. There is no human grant and no import grant.',
    );
  }
  if (action === 'revoke') {
    console.log(JSON.stringify({ id: argument('--id'), apply }));
    if (!apply) return;
    const sql = postgres(url, { max: 1 });
    try {
      await sql`update growth_access_grants set revoked_at = now() where id = ${argument('--id')} and revoked_at is null`;
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  if (action !== 'issue') throw new Error('access issue or access revoke');
  const label = argument('--label');
  if (label !== 'marketing-bot') {
    throw new Error('The only report principal label is marketing-bot');
  }
  const expiresAt = process.argv.includes('--expires-at')
    ? argument('--expires-at')
    : null;
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('--expires-at must be an ISO timestamp');
  }
  const grant = {
    principal: 'marketing_bot',
    permission: 'marketing.bot.read',
    apply,
    expiresAt,
  };
  if (!apply) {
    console.log(JSON.stringify(grant));
    return;
  }
  const token = newMachineToken();
  const sql = postgres(url, { max: 1 });
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into growth_access_grants
        (permission, principal_kind, token_hash, label, expires_at)
      values
        ('marketing.bot.read', 'marketing_bot', ${tokenHash(token)}, ${label}, ${expiresAt})
      returning id
    `;
    console.log(JSON.stringify({ ...grant, id: row.id, token }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function adminAccount(
  url: string,
  apply: boolean,
  action: 'bootstrap' | 'recover',
) {
  const email = normalizeEmail(argument('--email'));
  if (!email) throw new Error('--email must be a normal email address');
  const hasPermissions = process.argv.includes('--permissions');
  if (hasPermissions && action !== 'bootstrap')
    throw new Error('--permissions is only supported during bootstrap');
  const permissions = bootstrapPermissions(
    hasPermissions ? argument('--permissions') : undefined,
  );
  if (!permissions)
    throw new Error(
      '--permissions must contain only reports.read and dashboard.access',
    );
  const plaintext = temporaryPassword();
  const passwordHash = await hashPassword(plaintext);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const summary = {
    action,
    email,
    apply,
    permissions: action === 'bootstrap' ? permissions : undefined,
    expiresAt,
  };
  if (!apply) {
    console.log(JSON.stringify(summary));
    return;
  }
  const sql = postgres(url, { max: 1 });
  try {
    if (action === 'bootstrap') {
      await sql.begin(async (tx) => {
        await tx`lock table admin_accounts in share row exclusive mode`;
        const existing =
          await tx`select id from admin_accounts where is_master`;
        if (existing.length > 0)
          throw new Error('A master admin already exists');
        const [account] = await tx`
          insert into admin_accounts (
            email, password_hash, is_master, status, must_change_password, temp_password_expires_at
          ) values (
            ${email}, ${passwordHash}, true, 'invited', true, ${expiresAt}
          ) returning id
        `;
        for (const permission of permissions) {
          await tx`insert into admin_permissions (account_id, permission) values (${account.id as string}, ${permission})`;
        }
      });
      console.log(JSON.stringify({ ...summary, temporaryPassword: plaintext }));
      return;
    }
    const masters = await sql`
      select id from admin_accounts where email = ${email} and is_master
    `;
    if (masters.length !== 1)
      throw new Error('That master admin was not found');
    const id = masters[0].id as string;
    await sql.begin(async (tx) => {
      await tx`
        update admin_accounts set
          password_hash = ${passwordHash},
          status = 'invited',
          must_change_password = true,
          temp_password_expires_at = ${expiresAt},
          temp_password_used_at = null,
          revoked_at = null
        where id = ${id}
      `;
      await tx`update admin_sessions set revoked_at = now() where account_id = ${id} and revoked_at is null`;
    });
    console.log(JSON.stringify({ ...summary, temporaryPassword: plaintext }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}
