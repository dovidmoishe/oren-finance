import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const text = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

test('preview postgres health waits for TCP, not the first-boot socket', () => {
  const compose = text('./compose.yml');
  assert.match(compose, /pg_isready -h 127\.0\.0\.1 -p 5432 -U oren_preview -d oren_preview/);
  assert.doesNotMatch(compose, /pg_isready -U oren_preview -d oren_preview/);
});

test('a shutting-down database is retried and a real isolation miss is not', () => {
  const probe = spawnSync('bash', ['-c', `
    set -euo pipefail
    source infra/preview/isolation.sh
    export ISOLATION_READY_SECONDS=3
    counter=\$(mktemp)
    echo 0 > "\$counter"
    b() {
      n=\$(cat "\$counter")
      n=\$((n + 1))
      echo "\$n" > "\$counter"
      if (( n == 1 )); then
        echo 'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  the database system is shutting down' >&2
        return 2
      fi
      printf 't'
    }
    test "\$(psql_try b -Atc 'SELECT 1')" = t
    test "\$(cat "\$counter")" -eq 2
    b() { printf 'f'; }
    test "\$(psql_try b -Atc 'SELECT 1')" = f
    b() { echo 'ERROR: relation "preview_isolation" does not exist' >&2; return 3; }
    started=\$SECONDS
    set +e
    psql_try b -Atc 'SELECT value FROM preview_isolation'
    status=\$?
    set -e
    test "\$status" -eq 3
    test \$((SECONDS - started)) -lt 2
  `], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)) });
  assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
});
