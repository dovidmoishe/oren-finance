"""Root-owned heavy-job admission; identity comes from Unix peer credentials.

The idle cap stays 512 MiB. Rootless dockerd was measured at 235 MiB idle and
1.35 GiB at a build peak, so MemoryMax is lowered only after the cgroup has
fallen back under the idle cap with margin. A live worker lease is never
cleared because its client disconnected.
"""
import json
import os
import grp
import pwd
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path


def _budget():
    with Path(__file__).with_name('budgets.json').open() as source:
        return json.load(source)


BUDGET = _budget()
ACTIVE_MAX_MIB = BUDGET['heavyActiveMaxMiB']
ACTIVE_HIGH_MIB = BUDGET['heavyActiveHighMiB']
ACTIVE_CPU = BUDGET['heavyActiveCpuPercent']
IDLE_MAX_MIB = BUDGET['heavyIdleMaxMiB']
IDLE_HIGH_MIB = BUDGET['heavyIdleHighMiB']
IDLE_CPU = BUDGET['heavyIdleCpuPercent']
LIGHT_MAX_MIB = BUDGET['lightMaxMiB']
LIGHT_HIGH_MIB = BUDGET['lightHighMiB']
LIGHT_CPU = BUDGET['lightCpuPercent']
CONTROL_MAX_MIB = BUDGET['controlMaxMiB']
MARGIN_MIB = BUDGET['downshiftMarginMiB']
HOST_MIB = BUDGET['hostMiB']


def mib(value):
    return value * 1024 * 1024


IDLE_BYTES = mib(IDLE_MAX_MIB)
MARGIN_BYTES = mib(MARGIN_MIB)


def slice_within_idle(usage_bytes):
    return usage_bytes + MARGIN_BYTES <= IDLE_BYTES


def simultaneous_mib():
    """One heavy active, one heavy idle, one light, and the control account."""
    return ACTIVE_MAX_MIB + IDLE_MAX_MIB + LIGHT_MAX_MIB + CONTROL_MAX_MIB


def set_slice(uid, max_mib, high_mib, cpu):
    subprocess.run(
        ['systemctl', 'set-property', '--runtime', f'user-{uid}.slice',
         f'MemoryMax={max_mib}M', f'MemoryHigh={high_mib}M',
         f'CPUQuota={cpu}%', 'MemorySwapMax=0'],
        check=True, timeout=15, capture_output=True)


def limit(uid, active):
    if active:
        set_slice(uid, ACTIVE_MAX_MIB, ACTIVE_HIGH_MIB, ACTIVE_CPU)
    else:
        set_slice(uid, IDLE_MAX_MIB, IDLE_HIGH_MIB, IDLE_CPU)


def protect(uid, usage_bytes):
    """Lower CPU without setting MemoryHigh or MemoryMax under current usage."""
    usage_mib = (usage_bytes + mib(1) - 1) // mib(1)
    high = min(ACTIVE_MAX_MIB, max(IDLE_HIGH_MIB, usage_mib))
    set_slice(uid, ACTIVE_MAX_MIB, high, IDLE_CPU)


def reclaim_file_cache(uid, nbytes):
    """Ask the kernel to reclaim file pages in the full user slice. This does not kill dockerd."""
    path = f'/sys/fs/cgroup/user.slice/user-{uid}.slice/memory.reclaim'
    with open(path, 'w') as target:
        target.write(f'{max(0, int(nbytes))}\n')


RECLAIM_CHUNK = mib(256)
PROGRESS_BYTES = mib(32)
NO_PROGRESS_LIMIT = 6
RECOVERY = (
    'heavy queue held; MemoryMax was not lowered; '
    'recovery: write a bounded byte count to the user slice memory.reclaim '
    'and wait for memory.current to fall inside 512 MiB plus margin; '
    'do not kill dockerd and do not admit a second heavy job'
)


def cgroup_usage(uid):
    path = f'/sys/fs/cgroup/user.slice/user-{uid}.slice/memory.current'
    with open(path) as source:
        return int(source.read().strip())


def account_has_worker(uid):
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        try:
            with open(f'/proc/{name}/comm') as source:
                if source.read().strip() != 'Runner.Worker':
                    continue
            with open(f'/proc/{name}/status') as source:
                status = dict(line.split(':', 1) for line in source if ':' in line)
            if any(int(value) != uid for value in status['Uid'].split()):
                continue
        except (OSError, ValueError, KeyError):
            continue
        return True
    return False


def worker_identity(pid, uid):
    if not isinstance(pid, int) or pid <= 1:
        raise ValueError('invalid worker pid')
    with open(f'/proc/{pid}/status') as source:
        status = dict(line.split(':', 1) for line in source if ':' in line)
    if any(int(value) != uid for value in status['Uid'].split()):
        raise ValueError('worker belongs to another user')
    with open(f'/proc/{pid}/comm') as source:
        if source.read().strip() != 'Runner.Worker':
            raise ValueError('not a runner worker')
    with open(f'/proc/{pid}/stat') as source:
        return source.read().rsplit(')', 1)[1].split()[19]


class Admission:
    def __init__(self, users, limiter=limit, identity=worker_identity, usage=None,
                 softener=None, worker_running=None, reclaimer=reclaim_file_cache,
                 protector=protect, diagnostic_path=None, no_progress_limit=NO_PROGRESS_LIMIT):
        self.users = users
        self.limiter = limiter
        self.identity = identity
        self.usage = usage or (lambda uid: 0)
        # softener is accepted so older callers keep working; drain uses protector.
        self.softener = softener or protector
        self.worker_running = worker_running or (lambda uid: False)
        self.reclaimer = reclaimer
        self.protector = protector
        self.diagnostic_path = diagnostic_path
        self.no_progress_limit = no_progress_limit
        self.condition = threading.Condition()
        self.lease = None
        self.held = set()
        self.progress = {}
        self.stuck = set()
        for uid in users:
            self.settle(uid)

    @property
    def active(self):
        return self.lease

    def _usage(self, uid):
        try:
            return self.usage(uid)
        except OSError as error:
            print(f'oren-ci admission: usage unreadable for uid {uid}: {error}', file=sys.stderr)
            return IDLE_BYTES + MARGIN_BYTES + 1

    def settle(self, uid):
        """Startup. A fat cgroup is held for reclaim; MemoryMax is not pulled down."""
        if slice_within_idle(self._usage(uid)):
            self.limiter(uid, False)
            self.held.discard(uid)
            self.stuck.discard(uid)
        else:
            self.held.add(uid)
            if self.worker_running(uid):
                print(f'oren-ci admission: uid {uid} still has a runner worker; '
                      'downshift will not treat a later waiter as this lease',
                      file=sys.stderr, flush=True)

    def acquire(self, uid, pid, timeout=1200):
        if uid not in self.users:
            raise ValueError('unknown peer')
        stamp = self.identity(pid, uid)
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.held or self.lease is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('build queue timeout')
                self.condition.wait(min(remaining, 1))
                if self.identity(pid, uid) != stamp:
                    raise ValueError('worker exited while queued')
            for other in self.users:
                if other != uid:
                    self.limiter(other, False)
            self.limiter(uid, True)
            self.held.add(uid)
            self.lease = (uid, pid, stamp)
        return stamp

    def note_worker_exit(self, uid, pid, stamp):
        with self.condition:
            if self.lease != (uid, pid, stamp):
                raise ValueError('lease mismatch')
            self.lease = None
            self.held.add(uid)
        return self.drain(uid)

    def release(self, uid, pid, stamp):
        self.note_worker_exit(uid, pid, stamp)

    def _finish_idle(self, uid):
        self.limiter(uid, False)
        with self.condition:
            if self.lease and self.lease[0] == uid:
                return False
            self.held.discard(uid)
            self.stuck.discard(uid)
            self.progress.pop(uid, None)
            self.condition.notify_all()
        return True

    def _diagnose(self, uid, usage):
        message = (f'oren-ci admission STUCK uid={uid} usage={usage} '
                   f'idle={IDLE_BYTES} {RECOVERY}')
        print(message, file=sys.stderr, flush=True)
        if self.diagnostic_path:
            try:
                with open(self.diagnostic_path, 'w') as target:
                    target.write(message + '\n')
            except OSError as error:
                print(f'oren-ci admission: diagnostic write failed: {error}', file=sys.stderr)

    def drain(self, uid):
        """Reclaim file cache until the full user slice fits the idle cap.

        Only the identity-bound admitted worker blocks this. A later worker
        waiting to acquire does not. No-progress stops the reclaim attempts,
        leaves MemoryMax at the active cap, and keeps the heavy slot.
        """
        with self.condition:
            if uid not in self.held:
                return True
            if self.lease and self.lease[0] == uid:
                return False
        usage = self._usage(uid)
        if slice_within_idle(usage):
            return self._finish_idle(uid)
        state = self.progress.setdefault(uid, {'last': usage, 'flat': 0})
        if uid in self.stuck:
            if slice_within_idle(usage):
                return self._finish_idle(uid)
            return False
        try:
            self.reclaimer(uid, min(RECLAIM_CHUNK, max(0, usage - IDLE_BYTES)))
        except OSError as error:
            print(f'oren-ci admission: reclaim failed for uid {uid}: {error}', file=sys.stderr)
        usage = self._usage(uid)
        if slice_within_idle(usage):
            return self._finish_idle(uid)
        if state['last'] - usage >= PROGRESS_BYTES:
            state['last'] = usage
            state['flat'] = 0
        else:
            state['flat'] += 1
        self.protector(uid, usage)
        if state['flat'] >= self.no_progress_limit:
            self.stuck.add(uid)
            self._diagnose(uid, usage)
        else:
            print(f'oren-ci admission: uid {uid} uses {usage} bytes after reclaim; heavy slot held',
                  file=sys.stderr, flush=True)
        return False


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        uid = struct.unpack('3i', self.request.getsockopt(
            socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
        self.request.settimeout(5)
        pid = int(self.rfile.readline(32).strip())
        stamp = self.server.admission.acquire(uid, pid)
        try:
            self.wfile.write(b'OK\n')
            self.wfile.flush()
        except OSError:
            pass
        # Client disconnect cannot release a live worker's budget. PID start
        # time prevents PID reuse from extending the lease indefinitely.
        while True:
            try:
                if worker_identity(pid, uid) != stamp:
                    break
            except (OSError, ValueError, KeyError):
                break
            time.sleep(1)
        self.server.admission.note_worker_exit(uid, pid, stamp)
        while not self.server.admission.drain(uid):
            time.sleep(1)


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    request_queue_size = 8


def _reap(admission):
    while True:
        for uid in list(admission.held):
            try:
                admission.drain(uid)
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                print(f'oren-ci admission: drain uid {uid} failed: {error}', file=sys.stderr)
        time.sleep(1)


if __name__ == '__main__':
    users = [pwd.getpwnam(name).pw_uid for name in ('oren-ci-build', 'oren-ci-release')]
    admission = Admission(users, usage=cgroup_usage, worker_running=account_has_worker)
    threading.Thread(target=_reap, args=(admission,), daemon=True).start()
    address = '/run/oren-ci-build/admission.sock'
    if os.path.exists(address):
        os.unlink(address)
    with Server(address, Handler) as server:
        server.admission = admission
        os.chown(address, 0, grp.getgrnam('oren-ci-workers').gr_gid)
        os.chmod(address, 0o660)
        server.serve_forever()
