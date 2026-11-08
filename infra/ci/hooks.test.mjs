import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const startedHash = '9a349f812fbbaddf53366ed2502c7040ac64d66c2fbba1163a656ac79b0272cf';
const completedHash = 'adc77f9de26d18d6291a0b43950078298001e76f3e6b94bc557bd6876a3f8a9c';
const scriptPath = name => fileURLToPath(new URL(name, import.meta.url));
const text = name => readFileSync(scriptPath(name), 'utf8');
const inspection = '/usr/bin/timeout --signal=TERM --kill-after=5s 30s docker info --format \'{{.DockerRootDir}}|{{.CgroupDriver}}\'';

test('tracked runner hooks match the installed host bytes', () => {
  const hash = name => createHash('sha256').update(readFileSync(scriptPath(name))).digest('hex');
  assert.equal(hash('job-started.sh'), startedHash);
  assert.equal(hash('job-completed.sh'), completedHash);
});

test('startup takes the worker lease before one bounded docker inspection', () => {
  const started = text('job-started.sh');
  const completed = text('job-completed.sh');
  assert.ok(started.indexOf('trusted-job.mjs release') < started.indexOf('lease-client.py'));
  assert.ok(started.indexOf('export DOCKER_HOST=') < started.indexOf('lease-client.py'));
  assert.ok(started.indexOf('lease-client.py') < started.indexOf('docker_info='));
  assert.equal(started.match(/docker info/g).length, 1);
  assert.equal(completed.match(/docker info/g).length, 1);
  assert.ok(started.includes(inspection));
  assert.ok(completed.includes(inspection));
  assert.ok(completed.includes('/usr/bin/timeout --signal=TERM --kill-after=5s 30s docker ps -aq'));
  assert.ok(completed.includes('/usr/bin/timeout --signal=TERM --kill-after=5s 60s docker rm -fv'));
  assert.ok(completed.includes('/usr/bin/timeout --signal=TERM --kill-after=5s 15s docker logout ghcr.io'));
  assert.match(started, /for attempt in \{1\.\.180\}/);
  assert.match(started, /available >= 4718592 && disk >= 15728640/);
  assert.match(started, /previews remain running/);
  assert.match(started, /trap 'exit 130' INT/);
  assert.match(started, /trap 'exit 143' TERM/);
  assert.doesNotMatch(started, /\/var\/run\/docker\.sock|systemctl|docker (system )?prune/);
  assert.doesNotMatch(completed, /\/var\/run\/docker\.sock|systemctl|docker (system )?prune|lease-client/);
  const lease = text('lease-client.py');
  assert.match(lease, /str\(int\(sys\.argv\[1\]\)\)/);
  assert.match(lease, /client\.recv\(32\) != b'OK\\n'/);
  assert.doesNotMatch(lease, /release|systemctl/i);
});

test('provision keeps root-owned hooks and the existing ceilings', () => {
  const provision = text('provision.sh');
  assert.match(provision, /\[\[ \$EUID == 0 \]\]/);
  assert.match(provision, /install -m 755 "\$SOURCE\/network.sh" "\$SOURCE\/job-started.sh" "\$SOURCE\/job-completed.sh" "\$ROOT\/bin\/"/);
  assert.match(provision, /MemoryHigh=448M\nMemoryMax=512M\nMemorySwapMax=0/);
  assert.match(provision, /MemoryMax=3840M MemoryHigh=3584M CPUQuota=100%/);
  assert.match(provision, /ExecStart=\/usr\/bin\/python3 \$ROOT\/bin\/admission.py/);
  assert.match(provision, /MemoryMax=128M\nCPUQuota=5%/);
  assert.doesNotMatch(provision, /Slice=oren-ci-build\.slice/);
});

test('gnu timeout returns 124 when the command exits on TERM', () => {
  const start = Date.now();
  const result = spawnSync('timeout', ['--signal=TERM', '--kill-after=5s', '1s', 'sleep', '30'], { encoding: 'utf8' });
  assert.equal(result.status, 124);
  assert.ok(Date.now() - start < 2500);
});

test('gnu timeout kill grace reaps a command that ignores TERM', () => {
  const start = Date.now();
  const result = spawnSync('timeout', ['--signal=TERM', '--kill-after=1s', '1s', 'python3', '-c', 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)'], { encoding: 'utf8' });
  const elapsed = Date.now() - start;
  assert.ok(elapsed > 1500 && elapsed < 4000, String(elapsed));
  assert.equal(result.signal, 'SIGKILL');
});

function writeExec(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function stage(options) {
  const dir = mkdtempSync(join(tmpdir(), 'oren-hook-'));
  mkdirSync(join(dir, 'bin'));
  writeExec(join(dir, 'bin/id'), `#!/bin/bash
case "$1" in
  -un) printf '%s\\n' "$ACCOUNT" ;;
  -u) printf '%s\\n' 4242 ;;
  *) exit 1 ;;
esac
`);
  writeExec(join(dir, 'bin/docker'), `#!/bin/bash
if [[ "\${TIMEOUT_MODE:-}" == hang ]]; then sleep 300; fi
printf 'docker %s\\n' "$*" >> "$DIR/trace.log"
case "$1" in
  info)
    case "\${DOCKER_MODE:-ok}" in
      bad-root) printf '%s\\n' /var/lib/docker\\|systemd ;;
      bad-driver) printf '%s\\n' "/home/\${ACCOUNT}/.local/share/docker|cgroupfs" ;;
      extra) printf '%s\\n' "/home/\${ACCOUNT}/.local/share/docker|systemd|bad" ;;
      *) printf '%s\\n' "/home/\${ACCOUNT}/.local/share/docker|systemd" ;;
    esac
    ;;
  ps)
    [[ "\${DOCKER_MODE:-ok}" == none ]] || printf 'abc123\\ndef456\\n'
    ;;
  rm|logout)
    [[ "$1" != logout || -z "\${LOGOUT_RC:-}" ]] || exit "$LOGOUT_RC"
    ;;
  *) echo "unexpected docker $*" >&2; exit 3 ;;
esac
`);
  writeExec(join(dir, 'bin/awk'), `#!/bin/bash
if [[ "$1" == '/MemAvailable:/ {print $2}' ]]; then printf '%s\\n' "$MEM_AVAILABLE"; exit 0; fi
if [[ "$1" == 'NR==2 {print $4}' ]]; then printf '%s\\n' "$DISK_AVAILABLE"; exit 0; fi
exec /usr/bin/awk "$@"
`);
  writeExec(join(dir, 'bin/df'), '#!/bin/bash\nprintf "stub\\nstub\\n"\n');
  writeExec(join(dir, 'bin/realpath'), '#!/bin/bash\nprintf \'%s\\n\' "$REALPATH_RESULT"\n');
  writeExec(join(dir, 'bin/rm'), '#!/bin/bash\nprintf \'%s\\n\' "$*" >> "$DIR/rm.log"\n');
  writeExec(join(dir, 'timeout'), `#!/bin/bash
if [[ "$1" != --signal=TERM || "$2" != --kill-after=5s ]]; then
  echo "unexpected timeout bound: $*" >&2
  exit 2
fi
duration=$3
case "$duration" in
  30s|60s|15s) ;;
  *) echo "unexpected timeout duration: $duration" >&2; exit 2 ;;
esac
shift 3
printf '%s %s\\n' "$duration" "$*" >> "$DIR/bounds.log"
if [[ "\${TIMEOUT_MODE:-}" == hang ]]; then exit 124; fi
"$@"
`);
  writeFileSync(join(dir, 'lease-client.py'), `import os, sys
with open(os.environ["DIR"] + "/trace.log", "a", encoding="utf-8") as handle:
    handle.write("lease %s\\n" % sys.argv[1])
raise SystemExit(int(os.environ.get("LEASE_RC", "0")))
`);
  writeExec(join(dir, 'node'), '#!/bin/bash\nprintf \'node %s\\n\' "$*" >> "$DIR/trace.log"\nexit "${NODE_RC:-0}"\n');
  writeExec(join(dir, 'launch.sh'), `#!/bin/bash
printf '%s\\n' $$ > "$DIR/worker.pid"
bash "$SCRIPT" >"$DIR/out" 2>"$DIR/err" &
printf '%s\\n' $! > "$DIR/script.pid"
wait $!
status=$?
printf '%s\\n' "$status" > "$DIR/status"
exit $status
`);
  writeExec(join(dir, 'harness.sh'), `#!/bin/bash
set -euo pipefail
mount -t tmpfs tmpfs /opt
mkdir -p /opt/oren-ci/bin /opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin
cp "$DIR/lease-client.py" /opt/oren-ci/bin/lease-client.py
cp "$DIR/node" /opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin/node
chmod 755 /opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin/node
mount --bind "$DIR/timeout" /usr/bin/timeout
export PATH="$DIR/bin:/usr/bin:/bin"
set +e
if [[ "\${WANT_WORKER}" == 1 ]]; then
  "$DIR/bin/Runner.Worker" "$DIR/launch.sh"
  status=$?
else
  bash "$SCRIPT" >"$DIR/out" 2>"$DIR/err"
  status=$?
  printf '%s\\n' "$status" > "$DIR/status"
fi
exit $status
`);
  cpSync('/bin/bash', join(dir, 'bin/Runner.Worker'));
  chmodSync(join(dir, 'bin/Runner.Worker'), 0o755);
  return dir;
}

function hookEnv(dir, options) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: dir,
    TMPDIR: dir,
    LANG: 'C',
    DIR: dir,
    SCRIPT: scriptPath(options.script),
    ACCOUNT: options.account ?? 'oren-ci-build',
    DOCKER_MODE: options.dockerMode ?? 'ok',
    TIMEOUT_MODE: options.timeoutMode ?? '',
    MEM_AVAILABLE: options.mem ?? '5000000',
    DISK_AVAILABLE: options.disk ?? '20000000',
    NODE_RC: String(options.nodeRc ?? 0),
    LEASE_RC: String(options.leaseRc ?? 0),
    LOGOUT_RC: options.logoutRc ?? '',
    REALPATH_RESULT: options.realpath ?? '',
    WANT_WORKER: options.worker === false ? '0' : '1',
    RUNNER_WORKSPACE: options.workspace ?? '',
  };
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function snapshot(dir, result = {}) {
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
    out: readOptional(join(dir, 'out')),
    err: readOptional(join(dir, 'err')),
    trace: readOptional(join(dir, 'trace.log')),
    bounds: readOptional(join(dir, 'bounds.log')),
    rm: readOptional(join(dir, 'rm.log')),
    worker: readOptional(join(dir, 'worker.pid')).trim(),
  };
}

function detail(info) {
  return `status=${info.status}\nharness=${info.stderr}\nout=${info.out}\nerr=${info.err}\ntrace=${info.trace}\nbounds=${info.bounds}\nrm=${info.rm}`;
}

function run(options) {
  const dir = stage(options);
  try {
    const result = spawnSync('unshare', ['--user', '--mount', '--map-root-user', 'bash', join(dir, 'harness.sh')], {
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 10000,
      env: hookEnv(dir, options),
    });
    const info = snapshot(dir, result);
    if (result.error) info.stderr += String(result.error);
    return info;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expect(info, check) {
  try {
    check(info);
  } catch (error) {
    error.message += `\n${detail(info)}`;
    throw error;
  }
}

describe('installed hook behavior', { concurrency: 1 }, () => {
  test('build preflight admits the worker, then accepts one rootless systemd record', () => {
    const info = run({ script: 'job-started.sh' });
    expect(info, () => {
      assert.equal(info.status, 0);
      assert.match(info.trace, /^lease \d+\ndocker info /);
      assert.equal(info.trace.match(/^lease (\d+)/m)[1], info.worker);
      assert.match(info.bounds, /^30s docker info /);
      assert.match(info.out, /admission granted/);
      assert.match(info.out, /systemd cgroup driver verified/);
      assert.match(info.out, /serving headroom verified/);
      assert.doesNotMatch(info.trace, /^node /m);
    });
  });

  test('release provenance runs before admission and docker', () => {
    const info = run({ script: 'job-started.sh', account: 'oren-ci-release' });
    expect(info, () => {
      assert.equal(info.status, 0);
      assert.match(info.trace, /^node \/opt\/oren-ci\/bin\/trusted-job\.mjs release\nlease \d+\ndocker info /);
    });
  });

  test('rejected release provenance does not take the heavy lease', () => {
    const info = run({ script: 'job-started.sh', account: 'oren-ci-release', nodeRc: 1 });
    expect(info, () => {
      assert.notEqual(info.status, 0);
      assert.match(info.trace, /^node /);
      assert.doesNotMatch(info.trace, /^lease /m);
      assert.equal(info.bounds, '');
    });
  });

  test('missing runner worker fails before admission and docker', () => {
    const info = run({ script: 'job-started.sh', worker: false });
    expect(info, () => {
      assert.notEqual(info.status, 0);
      assert.equal(info.trace, '');
      assert.equal(info.bounds, '');
      assert.doesNotMatch(info.out, /admission granted/);
    });
  });

  test('admission failure blocks docker inspection', () => {
    const info = run({ script: 'job-started.sh', leaseRc: 1 });
    expect(info, () => {
      assert.notEqual(info.status, 0);
      assert.match(info.trace, /^lease \d+\n$/);
      assert.equal(info.bounds, '');
      assert.match(info.err, /phase=admission/);
      assert.doesNotMatch(info.err, /budget remains bound/);
    });
  });

  for (const dockerMode of ['bad-root', 'bad-driver', 'extra']) {
    test(`startup rejects ${dockerMode} after the lease is held`, () => {
      const info = run({ script: 'job-started.sh', dockerMode });
      expect(info, () => {
        assert.notEqual(info.status, 0);
        assert.match(info.trace, /^lease \d+\ndocker info /);
        assert.match(info.err, /phase=docker-validation/);
        assert.match(info.err, /budget remains bound to worker \d+/);
        assert.doesNotMatch(info.out, /serving headroom verified|systemd cgroup driver verified/);
      });
    });
  }

  test('a hung docker inspection fails closed inside the timeout bound', () => {
    const info = run({ script: 'job-started.sh', timeoutMode: 'hang', timeoutMs: 8000 });
    expect(info, () => {
      assert.equal(info.status, 124);
      assert.match(info.trace, /^lease \d+\n$/);
      assert.match(info.bounds, /^30s docker info /);
      assert.match(info.err, /phase=docker-validation/);
      assert.match(info.err, /budget remains bound/);
      assert.doesNotMatch(info.out, /workflow steps may start/);
    });
  });

  test('completion accepts the dedicated daemon, removes only its containers, and deletes the workspace', () => {
    const workspace = '/home/oren-ci-build/runner/_work/job';
    const info = run({
      script: 'job-completed.sh',
      worker: false,
      workspace: '/tmp/ignored-because-realpath-is-stubbed',
      realpath: workspace,
    });
    expect(info, () => {
      assert.equal(info.status, 0);
      assert.doesNotMatch(info.trace, /^lease /m);
      assert.deepEqual(info.bounds.trim().split('\n').map(line => line.split(' ').slice(0, 3).join(' ')), [
        '30s docker info',
        '30s docker ps',
        '60s docker rm',
        '15s docker logout',
      ]);
      assert.match(info.trace, /docker rm -fv abc123 def456/);
      assert.match(info.rm.trim(), /--one-file-system -- \/home\/oren-ci-build\/runner\/_work\/job$/);
    });
  });

  test('completion skips container removal when the daemon has none', () => {
    const info = run({ script: 'job-completed.sh', worker: false, dockerMode: 'none' });
    expect(info, () => {
      assert.equal(info.status, 0);
      assert.doesNotMatch(info.bounds, /docker rm/);
      assert.match(info.bounds, /15s docker logout/);
      assert.equal(info.rm, '');
    });
  });

  for (const dockerMode of ['bad-root', 'bad-driver', 'extra']) {
    test(`completion rejects ${dockerMode} before removing containers or the workspace`, () => {
      const info = run({
        script: 'job-completed.sh',
        worker: false,
        dockerMode,
        workspace: '/tmp/workspace',
        realpath: '/home/oren-ci-build/runner/_work/job',
      });
      expect(info, () => {
        assert.notEqual(info.status, 0);
        assert.doesNotMatch(info.trace, /docker (ps|rm|logout)/);
        assert.equal(info.rm, '');
        assert.match(info.err, /CI completion failed closed/);
        assert.match(info.err, /cleanup may be incomplete/);
      });
    });
  }

  test('a hung completion inspection does not remove containers or the workspace', () => {
    const info = run({
      script: 'job-completed.sh',
      worker: false,
      timeoutMode: 'hang',
      timeoutMs: 8000,
      workspace: '/tmp/workspace',
      realpath: '/home/oren-ci-build/runner/_work/job',
    });
    expect(info, () => {
      assert.equal(info.status, 124);
      assert.match(info.bounds, /^30s docker info /);
      assert.doesNotMatch(info.trace, /docker /);
      assert.equal(info.rm, '');
      assert.match(info.err, /CI completion failed closed/);
    });
  });

  test('registry logout failure still removes the verified workspace', () => {
    const info = run({
      script: 'job-completed.sh',
      worker: false,
      dockerMode: 'none',
      logoutRc: '1',
      workspace: '/tmp/workspace',
      realpath: '/home/oren-ci-build/runner/_work/job',
    });
    expect(info, () => {
      assert.equal(info.status, 0);
      assert.match(info.bounds, /15s docker logout ghcr.io/);
      assert.match(info.rm.trim(), /\/home\/oren-ci-build\/runner\/_work\/job$/);
    });
  });

  test('completion refuses a workspace outside the account work directory', () => {
    const info = run({
      script: 'job-completed.sh',
      worker: false,
      dockerMode: 'none',
      workspace: '/tmp/workspace',
      realpath: '/home/oren-ci-build/runner/.ssh',
    });
    expect(info, () => {
      assert.notEqual(info.status, 0);
      assert.equal(info.rm, '');
      assert.match(info.err, /CI completion failed closed/);
    });
  });

  test('interrupting headroom waits exits without releasing the worker lease', async () => {
    const dir = stage({ script: 'job-started.sh' });
    const child = spawn('unshare', ['--user', '--mount', '--map-root-user', 'bash', join(dir, 'harness.sh')], {
      env: hookEnv(dir, { script: 'job-started.sh', mem: '1', disk: '1' }),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let harness = '';
    child.stderr.on('data', chunk => { harness += chunk; });
    try {
      const started = Date.now();
      let out = '';
      while (!out.includes('serving-memory/disk headroom') && Date.now() - started < 8000) {
        out = readOptional(join(dir, 'out'));
        await delay(30);
      }
      assert.match(out, /serving-memory\/disk headroom/, harness);
      const pid = Number(readFileSync(join(dir, 'script.pid'), 'utf8'));
      process.kill(pid, 'SIGTERM');
      const [status] = await once(child, 'exit');
      const info = snapshot(dir, { status, stderr: harness });
      expect(info, () => {
        assert.equal(info.status, 143);
        assert.match(info.err, /phase=serving-headroom/);
        assert.match(info.err, new RegExp(`budget remains bound to worker ${info.worker}`));
        assert.doesNotMatch(info.out, /serving headroom verified/);
      });
    } finally {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
