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
    """True only under the idle floor: current + 64 MiB <= 512 MiB.

    487 MiB is inside the 448–512 band and is not idle. Reclaim must
    request the bytes above 448 MiB; requesting only the bytes above
    512 MiB writes zero and then sticks.
    """
    return usage_bytes + MARGIN_BYTES <= IDLE_BYTES


def reclaim_needed(usage_bytes):
    floor = IDLE_BYTES - MARGIN_BYTES
    return max(0, usage_bytes - floor)


def light_headroom_ok(available_bytes, build_bytes, release_bytes, active=None):
    """Whether light work can start without giving up the production reserve.

    MemAvailable already excludes current slice usage. Only one heavy account
    can rise to 3840 MiB. An idle account rises from its current usage. A
    draining account is admitted only after it returns to the idle cap, so
    its rise is from that cap, not from a 256 MiB stub of the last step.
    `active` is 'build', 'release', or None when neither lease is held.
    """
    reserve = mib(BUDGET['prodReserveMiB'])
    light = mib(LIGHT_MAX_MIB)
    active_max = mib(ACTIVE_MAX_MIB)

    def rise(current, already_active):
        if already_active:
            return max(0, active_max - current)
        start = current if current <= IDLE_BYTES else IDLE_BYTES
        return max(0, active_max - start)

    if active == 'build':
        growth = rise(build_bytes, True)
    elif active == 'release':
        growth = rise(release_bytes, True)
    elif active is None:
        growth = max(rise(build_bytes, False), rise(release_bytes, False))
    else:
        raise ValueError('active must be build, release, or None')
    return available_bytes >= growth + light + reserve


def heavy_raise_ok(available_bytes, current_bytes, light_worker):
    """A heavy raise while light work is running must leave the reserve.

    Light's current RSS is already absent from MemAvailable. If its worker
    exists it may still climb to the full light cap, so count that cap.
    With no light worker the existing heavy path is unchanged.
    """
    if not light_worker:
        return True
    growth = max(0, mib(ACTIVE_MAX_MIB) - current_bytes)
    return available_bytes >= growth + mib(LIGHT_MAX_MIB) + mib(BUDGET['prodReserveMiB'])


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


def reclaim_file_cache(uid, nbytes, root='/sys/fs/cgroup'):
    """Ask the kernel to reclaim file pages in the full user slice.

    The live file is mode 0200 and owned by root. Admission runs as root.
    Writing it does not kill dockerd.
    """
    path = f'{root}/user.slice/user-{uid}.slice/memory.reclaim'
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
                 protector=protect, diagnostic_path=None, no_progress_limit=NO_PROGRESS_LIMIT,
                 available=None, light_running=None, status_path=None):
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
        self.available = available or (lambda: 1 << 62)
        self.light_running = light_running or (lambda: False)
        self.status_path = status_path
        self.condition = threading.Condition()
        self.lease = None
        self.held = set()
        self.progress = {}
        self.stuck = set()
        self.restore_lease()
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

    def restore_lease(self):
        """Reload a lease written before a crash. Do not invent one."""
        if not self.status_path:
            return
        try:
            with open(self.status_path) as handle:
                parts = handle.read().split()
        except OSError:
            return
        if len(parts) != 3:
            return
        try:
            uid = int(parts[0])
            pid = int(parts[1])
        except ValueError:
            return
        stamp = parts[2]
        if uid not in self.users:
            return
        try:
            if self.identity(pid, uid) != stamp:
                return
        except (OSError, ValueError, KeyError):
            return
        self.lease = (uid, pid, stamp)
        self.held.add(uid)

    def settle(self, uid):
        """Startup must not retune a slice that still has a live worker."""
        if self.lease and self.lease[0] == uid:
            return
        if self.worker_running(uid) and not slice_within_idle(self._usage(uid)):
            return
        if slice_within_idle(self._usage(uid)):
            self.limiter(uid, False)
            self.held.discard(uid)
            self.stuck.discard(uid)
        else:
            self.held.add(uid)

    def _wait(self, deadline, pid, uid, stamp):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('build queue timeout')
        self.condition.wait(min(remaining, 1))
        if self.identity(pid, uid) != stamp:
            raise ValueError('worker exited while queued')

    def acquire(self, uid, pid, timeout=1200):
        if uid not in self.users:
            raise ValueError('unknown peer')
        stamp = self.identity(pid, uid)
        deadline = time.monotonic() + timeout
        with self.condition:
            while True:
                while self.held or self.lease is not None:
                    self._wait(deadline, pid, uid, stamp)
                if any(other != uid and self.worker_running(other)
                       and not slice_within_idle(self._usage(other)) for other in self.users):
                    # A live worker on the other account has no reconstructed
                    # lease. Wait for it to exit. Do not lower its caps.
                    self._wait(deadline, pid, uid, stamp)
                    continue
                deferred = False
                for other in self.users:
                    if other != uid and not slice_within_idle(self._usage(other)):
                        self.held.add(other)
                        deferred = True
                if deferred:
                    continue
                if not heavy_raise_ok(self.available(), self._usage(uid), self.light_running()):
                    self._wait(deadline, pid, uid, stamp)
                    continue
                for other in self.users:
                    if other != uid:
                        self.limiter(other, False)
                self.limiter(uid, True)
                self.held.add(uid)
                self.lease = (uid, pid, stamp)
                self._write_status(uid, pid, stamp)
                break
        return stamp

    def _write_status(self, uid, pid=None, stamp=None):
        if not self.status_path:
            return
        payload = b'' if uid is None else f'{uid} {pid} {stamp}\n'.encode()
        try:
            directory = os.path.dirname(self.status_path)
            if directory:
                os.makedirs(directory, mode=0o755, exist_ok=True)
            descriptor = os.open(self.status_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
            try:
                os.write(descriptor, payload)
            finally:
                os.close(descriptor)
            os.chmod(self.status_path, 0o644)
        except OSError as error:
            print(f'oren-ci admission: status write failed: {error}', file=sys.stderr)

    def release_if_worker_gone(self):
        with self.condition:
            lease = self.lease
        if lease is None:
            return
        uid, pid, stamp = lease
        try:
            if self.identity(pid, uid) == stamp:
                return
        except (OSError, ValueError, KeyError):
            pass
        try:
            self.note_worker_exit(uid, pid, stamp)
        except ValueError:
            return

    def note_worker_exit(self, uid, pid, stamp):
        with self.condition:
            if self.lease != (uid, pid, stamp):
                raise ValueError('lease mismatch')
            self.lease = None
            self.held.add(uid)
            self._write_status(None)
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
            needed = reclaim_needed(usage)
            if needed:
                self.reclaimer(uid, min(RECLAIM_CHUNK, needed))
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
        try:
            admission.release_if_worker_gone()
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            print(f'oren-ci admission: lease check failed: {error}', file=sys.stderr)
        for uid in list(admission.held):
            try:
                admission.drain(uid)
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                print(f'oren-ci admission: drain uid {uid} failed: {error}', file=sys.stderr)
        time.sleep(1)


if __name__ == '__main__':
    users = [pwd.getpwnam(name).pw_uid for name in ('oren-ci-build', 'oren-ci-release')]
    admission = Admission(
        users, usage=cgroup_usage, worker_running=account_has_worker,
        status_path='/run/oren-ci-status/heavy-lease')
    threading.Thread(target=_reap, args=(admission,), daemon=True).start()
    address = '/run/oren-ci-build/admission.sock'
    if os.path.exists(address):
        os.unlink(address)
    with Server(address, Handler) as server:
        server.admission = admission
        os.chown(address, 0, grp.getgrnam('oren-ci-workers').gr_gid)
        os.chmod(address, 0o660)
        server.serve_forever()
