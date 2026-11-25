import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = (value) => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const sha = 'a'.repeat(40), oldSha = 'b'.repeat(40), digest = `sha256:${'c'.repeat(64)}`;
const source = fs.readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('./admin.caddy', import.meta.url), 'utf8');
const handRunRoute = 'admin.oren.finance {\n  reverse_proxy oren-admin:8080\n}\n';
const indexBody = '<!doctype html><div id="root"></div>';
const indexHash = createHash('sha256').update(indexBody).digest('hex');

function run({ failure = '', previous = false, currentRoute = handRunRoute, handRun = 'oren-admin', expected = digest } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oren-admin-deploy-'));
  const incoming = path.join(root, 'incoming'), bin = path.join(root, 'bin'), sites = path.join(root, 'sites');
  for (const dir of [incoming, bin, sites]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(incoming, 'deploy.sh'), source);
  fs.writeFileSync(path.join(incoming, 'compose.yml'), 'new-compose\n');
  fs.writeFileSync(path.join(incoming, 'admin.caddy'), route);
  if (currentRoute !== null) fs.writeFileSync(path.join(sites, 'production-admin.caddy'), currentRoute);
  if (previous) {
    fs.writeFileSync(path.join(root, 'release.env'), `ADMIN_IMAGE=old-image\nADMIN_RELEASE_SHA=${oldSha}\n`);
    fs.writeFileSync(path.join(root, 'compose.yml'), 'old-compose\n');
  }
  fs.writeFileSync(path.join(bin, 'flock'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
echo "curl $*" >> "$MOCK_LOG"
if [[ "$MOCK_FAIL" == edge ]]; then printf 'previous release'; else printf '%s' "$MOCK_INDEX_BODY"; fi
`, { mode: 0o755 });
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
  'container inspect') [[ -n "$MOCK_HAND_RUN" && "$3" == "$MOCK_HAND_RUN" ]]; exit $? ;;
  'image inspect')
    if [[ "$*" == *Labels* ]]; then
      if [[ "$MOCK_FAIL" == revision ]]; then echo wrong; else echo "$MOCK_SHA"; fi
    else echo "ghcr.io/example/oren-admin@$MOCK_DIGEST"; fi ;;
  'compose --env-file')
    if [[ "$*" == *' up '* ]]; then
      cat "$OREN_ADMIN_ROOT/release.env" >> "$MOCK_LOG"
      if [[ "$MOCK_FAIL" == container ]] && grep -q "$MOCK_SHA" "$OREN_ADMIN_ROOT/release.env"; then exit 1; fi
    fi ;;
  'exec oren-admin-dashboard')
    if [[ "$3" == sh && "$MOCK_FAIL" == proxy ]]; then exit 1; fi
    if [[ "$3" == sha256sum ]]; then echo "$MOCK_INDEX_HASH  /srv/index.html"; fi ;;
  'exec oren-caddy-1')
    if [[ "$MOCK_FAIL" == caddy && "$*" == *validate* ]] && grep -q oren-admin-dashboard "$OREN_ADMIN_SITES/production-admin.caddy" 2>/dev/null; then exit 1; fi ;;
esac
`, { mode: 0o755 });
  const result = spawnSync(bash, ['--noprofile', '--norc', '-c', 'export PATH="$MOCK_BIN:$PATH"; exec bash "$@"', 'admin-test', posix(path.join(incoming, 'deploy.sh')), 'example', sha, 'tester', expected], {
    encoding: 'utf8', input: 'disposable-registry-token',
    env: { ...process.env, OREN_ADMIN_ROOT: posix(root), OREN_ADMIN_SITES: posix(sites),
      MOCK_BIN: posix(bin), MOCK_LOG: posix(path.join(root, 'commands')), MOCK_SHA: sha, MOCK_DIGEST: digest,
      MOCK_FAIL: failure, MOCK_HAND_RUN: handRun, MOCK_INDEX_BODY: indexBody, MOCK_INDEX_HASH: indexHash },
  });
  const read = (name) => fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), 'utf8') : null;
  const output = {
    result, release: read('release.env'), previous: read('previous-release.env'), compose: read('compose.yml'),
    replaced: read('replaced-route.caddy'), retiredName: read('retired-container'),
    route: read('sites/production-admin.caddy'), commands: read('commands') ?? '',
    leftovers: fs.readdirSync(root).filter((name) => name.startsWith('.deploy.') && name !== '.deploy.lock'),
    stray: fs.readdirSync(sites).filter((name) => name !== 'production-admin.caddy'),
  };
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(output.commands.length > 0, `Deployment harness did not run: ${result.stderr}`);
  return output;
}

const retired = (commands) => /^(update --restart=no|stop) oren-admin$/m.test(commands);

test('hands over from the hand-run dashboard once the new release serves through Caddy', () => {
  const r = run();
  assert.equal(r.result.status, 0, r.result.stderr);
  assert.equal(r.route, route);
  assert.match(r.release, new RegExp(`ADMIN_IMAGE=ghcr.io/example/oren-admin@${digest}`));
  assert.match(r.release, new RegExp(`ADMIN_RELEASE_SHA=${sha}`));
  assert.match(r.result.stdout, new RegExp(`ADMIN_INDEX_SHA256=${indexHash}`));
  assert.match(r.result.stdout, /Stopped the previous dashboard container oren-admin/);
  const at = (text) => r.commands.indexOf(text);
  assert.ok(at('caddy validate') < at('caddy reload'));
  assert.ok(at('caddy reload') < at('curl '), 'the edge is checked after Caddy follows the new route');
  assert.ok(at('curl ') < at('update --restart=no oren-admin'), 'the old dashboard keeps serving until the edge check passes');
  assert.ok(at('update --restart=no oren-admin') < at('stop oren-admin'));
  assert.doesNotMatch(r.commands, /^rm /m, 'the old dashboard is stopped, never removed');
  assert.equal(r.replaced, handRunRoute, 'the hand-run route is kept for manual recovery');
  assert.equal(r.retiredName, 'oren-admin\n');
  assert.match(r.commands, /--resolve admin\.oren\.finance:443:127\.0\.0\.1 https:\/\/admin\.oren\.finance\//);
  assert.deepEqual(r.leftovers, []);
  assert.deepEqual(r.stray, []);
});

test('a later release keeps the route byte-for-byte and records the previous image', () => {
  const r = run({ previous: true, currentRoute: route, handRun: '' });
  assert.equal(r.result.status, 0, r.result.stderr);
  assert.equal(r.route, route);
  assert.match(r.previous, new RegExp(oldSha));
  assert.doesNotMatch(r.commands, /caddy reload/);
  assert.match(r.commands, /^curl /m);
  assert.equal(retired(r.commands), false);
  assert.equal(r.replaced, null);
});

test('the first release also works when no route exists yet', () => {
  const r = run({ currentRoute: null, handRun: '' });
  assert.equal(r.result.status, 0, r.result.stderr);
  assert.equal(r.route, route);
  assert.equal(retired(r.commands), false);
});

for (const failure of ['pull', 'revision']) {
  test(`${failure} failure changes nothing that serves traffic`, () => {
    const r = run({ failure });
    assert.notEqual(r.result.status, 0);
    assert.equal(r.route, handRunRoute);
    assert.equal(r.release, null);
    assert.equal(retired(r.commands), false);
    assert.doesNotMatch(r.commands, /compose --env-file/);
    assert.deepEqual(r.leftovers, []);
  });
}

test('a digest that differs from the tested build is refused', () => {
  const r = run({ expected: `sha256:${'d'.repeat(64)}` });
  assert.notEqual(r.result.status, 0);
  assert.match(r.result.stderr, /digest mismatch/);
  assert.equal(r.route, handRunRoute);
  assert.equal(retired(r.commands), false);
});

for (const failure of ['container', 'proxy', 'caddy', 'edge']) {
  test(`${failure} failure during the handover restores the hand-run route and keeps it serving`, () => {
    const r = run({ failure });
    assert.notEqual(r.result.status, 0);
    assert.equal(r.route, handRunRoute, 'Caddy is pointed back at the hand-run dashboard');
    assert.equal(r.release, null);
    assert.equal(retired(r.commands), false, 'the hand-run dashboard is never stopped');
    assert.match(r.commands, /stop admin/);
    assert.deepEqual(r.leftovers, []);
    assert.deepEqual(r.stray, []);
  });
}

for (const failure of ['container', 'edge']) {
  test(`${failure} failure in a later release restores the previous release`, () => {
    const r = run({ failure, previous: true, currentRoute: route, handRun: '' });
    assert.notEqual(r.result.status, 0);
    assert.equal(r.release, `ADMIN_IMAGE=old-image\nADMIN_RELEASE_SHA=${oldSha}\n`);
    assert.equal(r.compose, 'old-compose\n');
    assert.equal(r.route, route);
    assert.ok(r.commands.lastIndexOf('ADMIN_IMAGE=old-image') > r.commands.indexOf(`ADMIN_RELEASE_SHA=${sha}`));
  });
}

test('the API proxy check failing names the cause', () => {
  const r = run({ failure: 'proxy' });
  assert.match(r.result.stderr, /cannot reach the API/);
});
