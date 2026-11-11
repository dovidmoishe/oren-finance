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


ACTIVE_BYTES = mib(ACTIVE_MAX_MIB)
CONTROL_BYTES = mib(CONTROL_MAX_MIB)
LIGHT_BYTES = mib(LIGHT_MAX_MIB)
HEAVY_SLOTS = BUDGET['heavyConcurrentMax']
RESERVE_BYTES = mib(BUDGET['prodReserveMiB'])
FREE_FLOOR_BYTES = mib(BUDGET['runtimeFreeFloorMiB'])


def admit_fits(available_bytes, growth_bytes):
    """True when projected growth leaves the runtime free-page floor.

    `prodReserveMiB` is the static host remainder after every full slice cap.
    Adding that remainder again on top of MemAvailable would reject the second
    heavy job this host was sized to run. The cgroup caps enforce that
    remainder. This check only refuses a raise whose remaining rise would
    leave fewer free pages than the runtime floor, and it fails closed when
    the numbers cannot be read.
    """
    if available_bytes < 0 or growth_bytes < 0:
        return False
    return available_bytes >= growth_bytes + FREE_FLOOR_BYTES


def heavy_raise_ok(available_bytes, growth_bytes, floor_bytes=None):
    """Compatibility wrapper. Growth already includes every slice that will expand."""
    if floor_bytes is None:
        return admit_fits(available_bytes, growth_bytes)
    return available_bytes >= growth_bytes + floor_bytes


def simultaneous_mib():
    """Two active heavy caps, one idle heavy cap, light, and control."""
    return (HEAVY_SLOTS * ACTIVE_MAX_MIB) + IDLE_MAX_MIB + LIGHT_MAX_MIB + CONTROL_MAX_MIB


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


class ReclaimDeferred(OSError):
    """The kernel would block or returned EAGAIN. The caller must not wait."""


def ensure_public_dir(path):
    """Create a directory other CI users can traverse.

    Admission's service umask is 0077, so makedirs(mode=0o755) would
    leave the status directory mode 0700 and the light account could not
    reach its socket.
    """
    os.makedirs(path, exist_ok=True)
    os.chmod(path, 0o755)


def reclaim_file_cache(uid, nbytes, root='/sys/fs/cgroup'):
    """Ask the kernel to reclaim file pages in the full user slice.

    The write is non-blocking. memory.reclaim returns EAGAIN when the
    kernel will not finish without sleeping, and a blocking write stalls
    the drain thread so no other waiter can be released. The live file is
    mode 0200 and owned by root. Admission runs as root. Writing it does
    not kill dockerd.
    """
    path = f'{root}/user.slice/user-{uid}.slice/memory.reclaim'
    payload = f'{max(0, int(nbytes))}\n'.encode()
    descriptor = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
    try:
        try:
            os.write(descriptor, payload)
        except BlockingIOError as error:
            raise ReclaimDeferred(error.errno, 'reclaim would block') from error
    finally:
        os.close(descriptor)


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


def read_mem_available():
    with open('/proc/meminfo') as source:
        for line in source:
            if line.startswith('MemAvailable:'):
                return int(line.split()[1]) * 1024
    raise OSError('MemAvailable missing')


def light_account_has_worker():
    try:
        uid = pwd.getpwnam('oren-ci-light').pw_uid
    except KeyError:
        return False
    try:
        return account_has_worker(uid)
    except OSError:
        return True


def light_account_configured():
    try:
        pwd.getpwnam('oren-ci-light')
    except KeyError:
        return False
    return True


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


def light_process_identity(pid, uid):
    """Light permits bind a same-user pid. They do not require Runner.Worker.

    The canary shell is not a runner worker. The socket peer still has to be
    the light account, so a heavy user cannot hold this permit.
    """
    if not isinstance(pid, int) or pid <= 1:
        raise ValueError('invalid light pid')
    with open(f'/proc/{pid}/status') as source:
        status = dict(line.split(':', 1) for line in source if ':' in line)
    if any(int(value) != uid for value in status['Uid'].split()):
        raise ValueError('light process belongs to another user')
    with open(f'/proc/{pid}/stat') as source:
        return source.read().rsplit(')', 1)[1].split()[19]


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
                 available=None, light_running=None, status_path=None,
                 heavy_slots=None, light_uid=None, light_identity=None,
                 light_configured=None, light_usage=None, control_usage=None,
                 light_status_path=None, reclaim_timeout=2, reclaim_retry=30):
        self.users = list(users)
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
        self.reclaim_timeout = reclaim_timeout
        self.reclaim_retry = reclaim_retry
        self.reclaim_inflight = set()
        self.last_reclaim = {}
        # Production must not treat memory as infinite or light work as absent.
        self.available = available if available is not None else read_mem_available
        self.light_running = light_running if light_running is not None else light_account_has_worker
        self.light_configured = light_configured if light_configured is not None else light_account_configured
        self.light_usage = light_usage if light_usage is not None else (lambda: 0)
        self.control_usage = control_usage if control_usage is not None else (lambda: 0)
        self.heavy_slots = HEAVY_SLOTS if heavy_slots is None else heavy_slots
        self.light_uid = light_uid
        self.light_identity = light_identity or light_process_identity
        self.status_path = status_path
        if light_status_path is not None:
            self.light_status_path = light_status_path
        elif status_path:
            self.light_status_path = str(Path(status_path).with_name('light-lease'))
        else:
            self.light_status_path = None
        self.condition = threading.Condition()
        self.leases = {}
        self.waiters = set()
        self.light_lease = None
        self.held = set()
        self.progress = {}
        self.stuck = set()
        self.events = []
        self.restore_lease()
        for uid in self.users:
            self.settle(uid)

    @property
    def lease(self):
        if len(self.leases) != 1:
            return None
        uid, (pid, stamp) = next(iter(self.leases.items()))
        return (uid, pid, stamp)

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
        """Reload leases written before a crash. Do not invent one."""
        if self.status_path:
            try:
                with open(self.status_path) as handle:
                    lines = [line.split() for line in handle.read().splitlines() if line.split()]
            except OSError:
                lines = []
        else:
            lines = []
        for parts in lines:
            if len(parts) != 3:
                continue
            try:
                uid = int(parts[0])
                pid = int(parts[1])
            except ValueError:
                continue
            stamp = parts[2]
            if uid not in self.users:
                continue
            try:
                if self.identity(pid, uid) != stamp:
                    continue
            except (OSError, ValueError, KeyError):
                continue
            self.leases[uid] = (pid, stamp)
            self.held.add(uid)
        self._restore_light()

    def _restore_light(self):
        """A crash must not forget a live light permit and hand out another."""
        if not self.light_status_path or self.light_uid is None:
            return
        try:
            with open(self.light_status_path) as handle:
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
        if uid != self.light_uid:
            return
        try:
            if self.light_identity(pid, uid) != stamp:
                return
        except (OSError, ValueError, KeyError):
            return
        self.light_lease = (pid, stamp)

    def settle(self, uid):
        """Startup must not retune a slice that still has a live worker."""
        if uid in self.leases:
            return
        if self.worker_running(uid) and not slice_within_idle(self._usage(uid)):
            return
        if slice_within_idle(self._usage(uid)):
            self.limiter(uid, False)
            self.held.discard(uid)
            self.stuck.discard(uid)
        else:
            self.held.add(uid)

    def _occupied(self):
        return set(self.leases) | set(self.held)

    def _blocking(self, uid):
        if uid in self.leases:
            return True
        # A finished worker's draining slice already occupies a heavy slot.
        # Reusing that same UID does not allocate another slot or raise its cap.
        if uid in self.held:
            return len(self._occupied()) > self.heavy_slots
        return len(self._occupied()) >= self.heavy_slots

    def _wait(self, deadline, pid, uid, stamp, identity=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('build queue timeout')
        self.condition.wait(min(remaining, 1))
        check = identity or self.identity
        if check(pid, uid) != stamp:
            raise ValueError('worker exited while queued')

    def _telemetry(self, kind, allowed, detail):
        line = f'oren-ci admission {kind} {"allow" if allowed else "deny"} {detail}'
        self.events.append(line)
        del self.events[:-50]
        print(line, file=sys.stderr, flush=True)
        if self.diagnostic_path and not allowed:
            try:
                with open(self.diagnostic_path, 'a') as target:
                    target.write(line + '\n')
            except OSError as error:
                print(f'oren-ci admission: diagnostic write failed: {error}', file=sys.stderr)

    def _optional_bytes(self, reader):
        try:
            return max(0, int(reader()))
        except OSError as error:
            raise OSError(f'usage unreadable: {error}') from error

    def _light_on(self):
        if self.light_lease is not None:
            return True
        try:
            return bool(self.light_running())
        except OSError as error:
            raise OSError(f'light state unreadable: {error}') from error

    def _growth(self, raise_uid=None):
        """Bytes the enforced caps can still add, worst case for a light start."""
        # Draining slices retain the active cap and must count at that cap too.
        leased = self._occupied()
        if raise_uid is not None:
            leased.add(raise_uid)
        speculative = 0 if raise_uid is not None else max(0, self.heavy_slots - len(leased))
        ranked = []
        growth = 0
        for uid in self.users:
            current = self._usage(uid)
            if uid in leased:
                growth += max(0, ACTIVE_BYTES - current)
            else:
                ranked.append((max(0, ACTIVE_BYTES - current), current))
        ranked.sort(reverse=True)
        for index, (active_rise, current) in enumerate(ranked):
            if index < speculative:
                growth += active_rise
            else:
                growth += max(0, IDLE_BYTES - current)
        # An idle light slice still has its full MemoryMax. Count it whenever
        # the account exists or a light worker is already running.
        if self.light_configured() or self._light_on():
            growth += max(0, LIGHT_BYTES - self._optional_bytes(self.light_usage))
        growth += max(0, CONTROL_BYTES - self._optional_bytes(self.control_usage))
        return growth

    def _decision(self, kind, raise_uid=None):
        try:
            available = self.available()
            if raise_uid is None:
                self._light_on()
            growth = self._growth(raise_uid)
        except OSError as error:
            self._telemetry(kind, False, f'unreadable:{error}')
            return False
        ok = admit_fits(available, growth)
        self._telemetry(kind, ok, f'available={available} growth={growth} floor={FREE_FLOOR_BYTES} slots={self.heavy_slots}')
        return ok

    def acquire(self, uid, pid, timeout=1200):
        if uid not in self.users:
            raise ValueError('unknown peer')
        stamp = self.identity(pid, uid)
        deadline = time.monotonic() + timeout
        with self.condition:
            waiter = (uid, pid, stamp)
            self.waiters.add(waiter)
            try:
                while True:
                    while self._blocking(uid):
                        self._wait(deadline, pid, uid, stamp)
                    if any(other != uid and other not in self._occupied()
                           and not any(waiter[0] == other for waiter in self.waiters)
                           and self.worker_running(other)
                           and not slice_within_idle(self._usage(other)) for other in self.users):
                        # A live worker on another account has no reconstructed
                        # lease. Wait for it to exit. Do not lower its caps.
                        self._wait(deadline, pid, uid, stamp)
                        continue
                    for other in self.users:
                        if other != uid and other not in self.leases and not slice_within_idle(self._usage(other)):
                            self.held.add(other)
                    # A fat slice that already exited occupies one held slot. A
                    # free slot must be granted. Continuing here without waiting
                    # used to spin while holding this condition, so a dead light
                    # permit could not be released and every other waiter stalled.
                    if self._blocking(uid):
                        self._wait(deadline, pid, uid, stamp)
                        continue
                    if not self._decision('heavy', uid):
                        self._wait(deadline, pid, uid, stamp)
                        continue
                    for other in self.users:
                        if other != uid and other not in self.leases and other not in self.held:
                            if slice_within_idle(self._usage(other)):
                                self.limiter(other, False)
                    self.limiter(uid, True)
                    self.held.add(uid)
                    self.leases[uid] = (pid, stamp)
                    self.stuck.discard(uid)
                    self.progress.pop(uid, None)
                    self._write_status()
                    break
            finally:
                self.waiters.discard(waiter)
        return stamp

    def acquire_light(self, pid, timeout=1200):
        if self.light_uid is None:
            raise ValueError('no light account')
        stamp = self.light_identity(pid, self.light_uid)
        deadline = time.monotonic() + timeout
        with self.condition:
            while True:
                if self.light_lease is not None:
                    self._wait(deadline, pid, self.light_uid, stamp, identity=self.light_identity)
                    continue
                if not self._decision('light', None):
                    self._wait(deadline, pid, self.light_uid, stamp, identity=self.light_identity)
                    continue
                self.light_lease = (pid, stamp)
                self._write_light_status()
                return stamp

    def _write_status(self):
        if not self.status_path:
            return
        lines = [f'{uid} {pid} {stamp}\n' for uid, (pid, stamp) in sorted(self.leases.items())]
        payload = ''.join(lines).encode()
        try:
            directory = os.path.dirname(self.status_path)
            if directory:
                ensure_public_dir(directory)
            descriptor = os.open(self.status_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
            try:
                os.write(descriptor, payload)
            finally:
                os.close(descriptor)
            os.chmod(self.status_path, 0o644)
        except OSError as error:
            print(f'oren-ci admission: status write failed: {error}', file=sys.stderr)

    def _write_light_status(self):
        if not self.light_status_path:
            return
        if self.light_lease is None:
            payload = b''
        else:
            pid, stamp = self.light_lease
            payload = f'{self.light_uid} {pid} {stamp}\n'.encode()
        try:
            directory = os.path.dirname(self.light_status_path)
            if directory:
                ensure_public_dir(directory)
            descriptor = os.open(self.light_status_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
            try:
                os.write(descriptor, payload)
            finally:
                os.close(descriptor)
            os.chmod(self.light_status_path, 0o644)
        except OSError as error:
            print(f'oren-ci admission: light status write failed: {error}', file=sys.stderr)

    def release_if_light_gone(self):
        with self.condition:
            lease = self.light_lease
            uid = self.light_uid
        if lease is None or uid is None:
            return
        pid, stamp = lease
        try:
            if self.light_identity(pid, uid) == stamp:
                return
        except (OSError, ValueError, KeyError):
            pass
        try:
            self.release_light(pid, stamp)
        except ValueError:
            return

    def release_if_worker_gone(self):
        with self.condition:
            items = list(self.leases.items())
        for uid, (pid, stamp) in items:
            try:
                if self.identity(pid, uid) == stamp:
                    continue
            except (OSError, ValueError, KeyError):
                pass
            try:
                self.note_worker_exit(uid, pid, stamp)
            except ValueError:
                continue

    def note_worker_exit(self, uid, pid, stamp):
        with self.condition:
            if self.leases.get(uid) != (pid, stamp):
                raise ValueError('lease mismatch')
            del self.leases[uid]
            self.held.add(uid)
            self._write_status()

    def release(self, uid, pid, stamp):
        self.note_worker_exit(uid, pid, stamp)
        self.drain(uid)

    def reap_once(self):
        """Drop dead leases before any reclaim, then reclaim without stalling.

        memory.reclaim can sleep even after EAGAIN. Doing that work before
        the light check, or on the admission lock, left a dead light pid
        holding the only permit while a new light worker waited out the
        1220s client timeout.
        """
        self.release_if_worker_gone()
        self.release_if_light_gone()
        for uid in list(self.held):
            self.drain(uid)

    def release_light(self, pid, stamp):
        with self.condition:
            if self.light_lease != (pid, stamp):
                raise ValueError('light lease mismatch')
            self.light_lease = None
            self._write_light_status()
            self.condition.notify_all()

    def _finish_idle(self, uid):
        with self.condition:
            if uid in self.leases:
                return False
            if not slice_within_idle(self._usage(uid)):
                return False
            self.limiter(uid, False)
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

    def _reclaim_bounded(self, uid, nbytes):
        """Run one reclaim without letting it stall every other waiter."""
        with self.condition:
            if uid in self.leases or uid in self.reclaim_inflight:
                return
            self.reclaim_inflight.add(uid)
        done = threading.Event()
        outcome = {}

        def run():
            try:
                self.reclaimer(uid, nbytes)
                outcome['ok'] = True
            except BaseException as error:
                outcome['error'] = error
            finally:
                with self.condition:
                    self.reclaim_inflight.discard(uid)
                done.set()

        self.last_reclaim[uid] = time.monotonic()
        threading.Thread(target=run, daemon=True).start()
        if not done.wait(self.reclaim_timeout):
            print(f'oren-ci admission: reclaim timed out for uid {uid}', file=sys.stderr, flush=True)
            return
        error = outcome.get('error')
        if error is None:
            return
        if isinstance(error, OSError):
            print(f'oren-ci admission: reclaim failed for uid {uid}: {error}', file=sys.stderr, flush=True)
            return
        raise error

    def drain(self, uid):
        """Reclaim file cache until the full user slice fits the idle cap.

        Only the identity-bound admitted worker blocks this. A later worker
        waiting to acquire does not. After repeated no-progress the slice
        stays at the active cap and keeps its heavy slot. Later attempts stay
        non-blocking and one per uid, so a cache drop can still release that
        slot without letting a stuck write stall the other slot.
        """
        with self.condition:
            if uid not in self.held:
                return True
            if uid in self.leases:
                return False
        usage = self._usage(uid)
        if slice_within_idle(usage):
            return self._finish_idle(uid)
        state = self.progress.setdefault(uid, {'last': usage, 'flat': 0})
        if uid in self.stuck:
            if slice_within_idle(usage):
                return self._finish_idle(uid)
            due = time.monotonic() - self.last_reclaim.get(uid, 0) >= self.reclaim_retry
            if due:
                needed = reclaim_needed(usage)
                if needed:
                    self._reclaim_bounded(uid, min(RECLAIM_CHUNK, needed))
                usage = self._usage(uid)
                if slice_within_idle(usage):
                    return self._finish_idle(uid)
            return False
        try:
            needed = reclaim_needed(usage)
            if needed:
                self._reclaim_bounded(uid, min(RECLAIM_CHUNK, needed))
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
        # Reclaim runs outside the lock. A successor may have reused this slot
        # while it ran; never downshift that newly admitted worker.
        with self.condition:
            if uid in self.leases:
                return False
            self.protector(uid, self._usage(uid))
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
            admission.reap_once()
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            print(f'oren-ci admission: lease check failed: {error}', file=sys.stderr)
        time.sleep(1)


class LightHandler(socketserver.StreamRequestHandler):
    def handle(self):
        uid = struct.unpack('3i', self.request.getsockopt(
            socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
        if uid != self.server.admission.light_uid:
            raise ValueError('light admission is only for the light account')
        self.request.settimeout(5)
        pid = int(self.rfile.readline(32).strip())
        stamp = self.server.admission.acquire_light(pid)
        try:
            self.wfile.write(b'OK\n')
            self.wfile.flush()
        except OSError:
            pass
        while True:
            try:
                if self.server.admission.light_identity(pid, uid) != stamp:
                    break
            except (OSError, ValueError, KeyError):
                break
            time.sleep(1)
        self.server.admission.release_light(pid, stamp)


def production_users():
    users = []
    for name in ('oren-ci-build', 'oren-ci-build-2', 'oren-ci-release'):
        try:
            users.append(pwd.getpwnam(name).pw_uid)
        except KeyError:
            if name != 'oren-ci-build-2':
                raise
    return users


def serve(admission):
    threading.Thread(target=_reap, args=(admission,), daemon=True).start()
    address = '/run/oren-ci-build/admission.sock'
    if os.path.exists(address):
        os.unlink(address)
    heavy = Server(address, Handler)
    heavy.admission = admission
    os.chown(address, 0, grp.getgrnam('oren-ci-workers').gr_gid)
    os.chmod(address, 0o660)
    threads = [threading.Thread(target=heavy.serve_forever, daemon=True)]
    if admission.light_uid is not None:
        light_address = '/run/oren-ci-status/light-admission.sock'
        ensure_public_dir('/run/oren-ci-status')
        if os.path.exists(light_address):
            os.unlink(light_address)
        light = Server(light_address, LightHandler)
        light.admission = admission
        os.chown(light_address, 0, pwd.getpwuid(admission.light_uid).pw_gid)
        os.chmod(light_address, 0o660)
        threads.append(threading.Thread(target=light.serve_forever, daemon=True))
    for thread in threads:
        thread.start()
    threads[0].join()


if __name__ == '__main__':
    light_uid = None
    try:
        light_uid = pwd.getpwnam('oren-ci-light').pw_uid
    except KeyError:
        light_uid = None
    admission = Admission(
        production_users(), usage=cgroup_usage, worker_running=account_has_worker,
        status_path='/run/oren-ci-status/heavy-lease', light_uid=light_uid)
    serve(admission)
