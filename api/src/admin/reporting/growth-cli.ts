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
  contentHash,
  recoveryToImport,
  validateImport,
  type GrowthImportDocument,
} from './growth-import';

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
  throw new Error('Use import recovery|file, caddy, or access issue|revoke');
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
  const accepted: PageviewDraft[] = [];
  for (const line of lines) {
    try {
      const draft = caddyLineToPageview(
        JSON.parse(line) as CaddyEvent,
        pepper,
        'Africa/Lagos',
      );
      if (draft) accepted.push(draft);
    } catch {
      // Skip a corrupt line. Do not invent a zero for it.
    }
  }
  console.log(
    JSON.stringify({ lines: lines.length, pageviews: accepted.length, apply }),
  );
  if (!apply) return;
  const sql = postgres(url, { max: 1 });
  try {
    for (const draft of accepted) {
      await sql`
        insert into growth_pageviews (
          occurred_at, path, visitor_hash, session_hash, visitor_stability, source, ingest_key, referrer_host
        ) values (
          ${draft.occurredAt}, ${draft.path}, ${draft.visitorHash}, ${draft.sessionHash},
          ${draft.visitorStability}, ${draft.source}, ${draft.ingestKey}, ${draft.referrerHost}
        )
        on conflict (ingest_key) do nothing
      `;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function access(url: string, apply: boolean) {
  const action = process.argv[3];
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
  const permission = argument('--permission');
  if (permission !== 'marketing.read' && permission !== 'marketing.import') {
    throw new Error('permission must be marketing.read or marketing.import');
  }
  const label = argument('--label');
  const user = process.argv.includes('--user') ? argument('--user') : undefined;
  const token = user ? undefined : newMachineToken();
  console.log(
    JSON.stringify({
      permission,
      principal: user ? 'privy_user' : 'machine',
      apply,
      token: apply ? token : undefined,
    }),
  );
  if (!apply) return;
  const sql = postgres(url, { max: 1 });
  try {
    await sql`
      insert into growth_access_grants (permission, principal_kind, privy_user_id, token_hash, label)
      values (
        ${permission}, ${user ? 'privy_user' : 'machine'}, ${user ?? null},
        ${token ? tokenHash(token) : null}, ${label}
      )
    `;
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
