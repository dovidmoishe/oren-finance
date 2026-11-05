import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = (value) => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const sha = 'a'.repeat(40), oldSha = 'b'.repeat(40), digest = `sha256:${'c'.repeat(64)}`;
const source = fs.readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8');

function run({ failure = '', previous = true, expected = digest, existingRoute = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oren-docs-deploy-'));
  const incoming = path.join(root, 'incoming'), bin = path.join(root, 'bin');
  fs.mkdirSync(incoming); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(incoming, 'deploy.sh'), source);
  fs.writeFileSync(path.join(incoming, 'compose.yml'), 'new-compose\n');
  const route = 'docs.oren.finance {\n  # new-route\n  reverse_proxy oren-docs:3000\n}\n';
  fs.writeFileSync(path.join(incoming, 'docs.caddy'), route);
  fs.writeFileSync(path.join(incoming, 'smoke.mjs'), '// public release check\n');
  fs.writeFileSync(path.join(root, 'Caddyfile'), 'old-route\n' + (existingRoute ? route : ''));
  if (previous) {
    fs.writeFileSync(path.join(root, 'release.env'), `DOCS_IMAGE=old-image\nDOCS_RELEASE_SHA=${oldSha}\n`);
    fs.writeFileSync(path.join(root, 'compose.yml'), 'old-compose\n');
  }
  fs.writeFileSync(path.join(bin, 'flock'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -eu
echo "$*" >> "$MOCK_LOG"
if [[ "$1" == --config ]]; then
  shift 2
  if [[ "$1" == login ]]; then cat >/dev/null; fi
  if [[ "$1" == pull && "$MOCK_FAIL" == pull ]]; then exit 1; fi
  exit 0
fi
case "$1 $2" in
  'inspect oren-docs') [[ -f "$OREN_DOCS_ROOT/release.env" ]]; exit $? ;;
  'image inspect')
    if [[ "$*" == *Labels* ]]; then
      if [[ "$MOCK_FAIL" == revision ]]; then echo wrong; else echo "$MOCK_SHA"; fi
    else echo "ghcr.io/example/oren-docs@$MOCK_DIGEST"; fi ;;
  'compose --env-file')
    if [[ "$*" == *' up '* ]]; then
      cat "$OREN_DOCS_ROOT/release.env" >> "$MOCK_LOG"
      if [[ "$MOCK_FAIL" == container ]] && grep -q "$MOCK_SHA" "$OREN_DOCS_ROOT/release.env"; then exit 1; fi
    fi ;;
  'exec -i') cat >/dev/null; [[ "$MOCK_FAIL" != public ]] ;;
  'exec oren-caddy-1')
    if [[ "$MOCK_FAIL" == caddy && "$*" == *validate* ]] && grep -q new-route "$OREN_DOCS_CADDY_FILE"; then exit 1; fi ;;
esac
`, { mode: 0o755 });
  const result = spawnSync(bash, ['--noprofile', '--norc', '-c', 'export PATH="$MOCK_BIN:$PATH"; exec bash "$@"', 'docs-test', posix(path.join(incoming, 'deploy.sh')), 'example', sha, 'tester', expected], {
    encoding: 'utf8', input: 'disposable-registry-token',
    env: { ...process.env, OREN_DOCS_ROOT: posix(root), OREN_DOCS_CADDY_FILE: posix(path.join(root, 'Caddyfile')),
      MOCK_BIN: posix(bin), MOCK_LOG: posix(path.join(root, 'commands')), MOCK_SHA: sha, MOCK_DIGEST: digest, MOCK_FAIL: failure },
  });
  const read = (name) => fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), 'utf8') : null;
  const output = { result, release: read('release.env'), caddy: read('Caddyfile'), compose: read('compose.yml'), previous: read('previous-release.env'), commands: read('commands') ?? '', leftovers: fs.readdirSync(root).filter((name) => name.startsWith('.deploy.') && name !== '.deploy.lock') };
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(output.commands.length > 0, `Deployment harness did not run: ${result.stderr}`);
  return output;
}

test('activates a digest-pinned docs release and records the previous image', () => {
  const r = run();
  assert.equal(r.result.status, 0, r.result.stderr);
  assert.match(r.release, new RegExp(`DOCS_IMAGE=ghcr.io/example/oren-docs@${digest}`));
  assert.match(r.previous, new RegExp(oldSha));
  assert.ok(r.caddy.startsWith('old-route\n'));
  assert.match(r.caddy, /docs\.oren\.finance \{/);
  assert.deepEqual(r.leftovers, []);
  assert.ok(r.commands.indexOf('caddy validate') < r.commands.indexOf('caddy reload'));
});
test('an existing docs host and newer main-site routing remain byte-for-byte unchanged', () => {
  const r = run({ existingRoute: true });
  assert.equal(r.result.status, 0, r.result.stderr);
  assert.equal(r.caddy, 'old-route\ndocs.oren.finance {\n  # new-route\n  reverse_proxy oren-docs:3000\n}\n');
});
for (const failure of ['pull', 'revision']) {
  test(`${failure} failure preserves the running release before activation`, () => {
    const r = run({ failure });
    assert.notEqual(r.result.status, 0);
    assert.match(r.release, new RegExp(oldSha));
    assert.equal(r.caddy, 'old-route\n');
    assert.doesNotMatch(r.commands, / up /);
    assert.deepEqual(r.leftovers, []);
  });
}
test('a changed registry digest is rejected before any service restart', () => {
  const r = run({ expected: `sha256:${'d'.repeat(64)}` });
  assert.notEqual(r.result.status, 0);
  assert.match(r.release, new RegExp(oldSha));
  assert.doesNotMatch(r.commands, / up /);
});
for (const failure of ['container', 'caddy', 'public']) {
  test(`${failure} failure restores the prior image, Compose file and Caddy route`, () => {
    const r = run({ failure });
    assert.notEqual(r.result.status, 0);
    assert.match(r.release, new RegExp(oldSha));
    assert.equal(r.compose, 'old-compose\n');
    assert.equal(r.caddy, 'old-route\n');
    assert.deepEqual(r.leftovers, []);
  });
}
test('a failed first deployment removes only its docs service and release record', () => {
  const r = run({ failure: 'public', previous: false });
  assert.notEqual(r.result.status, 0);
  assert.equal(r.release, null);
  assert.match(r.commands, / stop docs/);
  assert.match(r.commands, / rm -f docs/);
  assert.equal(r.caddy, 'old-route\n');
  assert.deepEqual(r.leftovers, []);
});
test('deployment never restarts the financial application services', () => {
  const r = run();
  assert.doesNotMatch(r.commands, /(?:up|stop|rm).*\b(?:api|app|db|signer-gate)\b/);
  assert.doesNotMatch(r.result.stdout + r.result.stderr, /disposable-registry-token/);
});
