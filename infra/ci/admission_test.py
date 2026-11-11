import os
import subprocess
import tempfile
import threading
import time
import unittest
from admission import (
    ACTIVE_MAX_MIB, CONTROL_MAX_MIB, HOST_MIB, IDLE_MAX_MIB, LIGHT_MAX_MIB,
    MARGIN_MIB, NO_PROGRESS_LIMIT, RECOVERY, Admission, ensure_public_dir,
    heavy_raise_ok, limit,
    light_headroom_ok, protect, reclaim_file_cache, reclaim_needed,
    simultaneous_mib, slice_within_idle, worker_identity,
)


class AdmissionTests(unittest.TestCase):
    def test_verified_waiters_do_not_mistake_each_other_for_untracked_work(self):
        usage = {1001: 0, 1003: 0}
        gate = Admission(list(usage), lambda *args: None, lambda pid, uid: str(pid),
                         usage=lambda uid: usage[uid], worker_running=lambda uid: True,
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=2)
        usage.update({1001: 500 * 1024 ** 2, 1003: 500 * 1024 ** 2})
        errors = []
        def acquire(uid, pid):
            try:
                gate.acquire(uid, pid, timeout=2)
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=acquire, args=(uid, pid))
                   for uid, pid in [(1001, 42), (1003, 43)]]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(3)
        self.assertEqual(errors, [])
        self.assertEqual(set(gate.leases), {1001, 1003})
        self.assertEqual(gate.waiters, set())

    def test_same_uid_reuses_draining_slot_without_waiting_for_reclaim(self):
        usage = {1001: 0, 1003: 0, 1004: 0}
        limits = []
        gate = Admission(list(usage), lambda *args: limits.append(args),
                         lambda pid, uid: str(pid), usage=lambda uid: usage[uid],
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=2,
                         reclaimer=lambda *args: None, protector=lambda *args: None)
        stamp = gate.acquire(1001, 42)
        usage[1001] = 600 * 1024 ** 2
        gate.release(1001, 42, stamp)
        gate.acquire(1003, 43)
        # Both slots are accounted for; only the draining UID can reuse one.
        with self.assertRaises(TimeoutError):
            gate.acquire(1004, 44, timeout=.02)
        successor = gate.acquire(1001, 45, timeout=.02)
        self.assertEqual(successor, '45')
        self.assertEqual(len(gate._occupied()), 2)
        self.assertFalse(gate._finish_idle(1001))
        self.assertFalse(gate.drain(1001))
        self.assertEqual(limits[-1], (1001, True))
        with self.assertRaises(TimeoutError):
            gate.acquire(1001, 46, timeout=.02)

    def test_reusing_draining_slot_still_requires_memory_headroom(self):
        gate = Admission([1001], lambda *args: None, lambda pid, uid: str(pid),
                         usage=lambda uid: 600 * 1024 ** 2, available=lambda: 0,
                         light_running=lambda: False, light_configured=lambda: False)
        with self.assertRaises(TimeoutError):
            gate.acquire(1001, 42, timeout=.02)
        self.assertEqual(gate.leases, {})

    def test_draining_slice_growth_is_counted_at_active_cap(self):
        gate = Admission([1001], lambda *args: None, lambda pid, uid: str(pid),
                         usage=lambda uid: 600 * 1024 ** 2,
                         light_running=lambda: False, light_configured=lambda: False,
                         control_usage=lambda: CONTROL_MAX_MIB * 1024 ** 2)
        self.assertEqual(gate._growth(1001), (ACTIVE_MAX_MIB - 600) * 1024 ** 2)
        self.assertEqual(gate._growth(), gate._growth(1001))

    def test_reclaim_completion_cannot_downshift_a_successor(self):
        usage = {1001: 600 * 1024 ** 2}
        limits = []
        protected = []
        gate = Admission([1001], lambda *args: limits.append(args),
                         lambda pid, uid: str(pid), usage=lambda uid: usage[uid],
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False,
                         protector=lambda *args: protected.append(args))
        def reclaim(uid, nbytes):
            gate.acquire(uid, 42, timeout=.02)
        gate.reclaimer = reclaim
        self.assertFalse(gate.drain(1001))
        self.assertEqual(gate.leases[1001], (42, '42'))
        self.assertEqual(limits[-1], (1001, True))
        self.assertEqual(protected, [])

    def test_budget_order_and_worker_lifetime(self):
        budgets = {}
        calls = []

        def limit(uid, active):
            budgets[uid] = 3840 if active else 512
            calls.append((uid, active))
            self.assertLessEqual(sum(budgets.values()), 4352)

        gate = Admission([1001, 1003], limit, lambda pid, uid: str(pid),
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=1)
        with self.assertRaises(ValueError):
            gate.acquire(0, 42)
        stamp = gate.acquire(1001, 42)
        self.assertEqual(calls[-2:], [(1003, False), (1001, True)])
        ready = threading.Event()

        def second():
            token = gate.acquire(1003, 43)
            ready.set()
            gate.release(1003, 43, token)

        thread = threading.Thread(target=second)
        thread.start()
        self.assertFalse(ready.wait(.1))
        with self.assertRaises(ValueError):
            gate.release(1001, 42, 'reused-pid')
        gate.release(1001, 42, stamp)
        self.assertTrue(ready.wait(2))
        thread.join(2)
        self.assertIsNone(gate.active)

    def test_limiter_error_fails_closed(self):
        def limit(uid, active):
            if active:
                raise RuntimeError('systemd unavailable')
        gate = Admission([1001, 1003], limit, lambda pid, uid: 'stamp',
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=1)
        with self.assertRaises(RuntimeError):
            gate.acquire(1001, 42)
        self.assertIsNone(gate.active)

    def test_peer_cannot_claim_another_user_or_nonworker(self):
        import os
        with self.assertRaises(ValueError):
            worker_identity(os.getpid(), os.getuid() + 1)
        with self.assertRaises(ValueError):
            worker_identity(os.getpid(), os.getuid())

    def test_protect_does_not_set_high_or_max_under_current_usage(self):
        recorded = []

        def fake_run(argv, **kwargs):
            recorded.append(argv)
            return subprocess.CompletedProcess(argv, 0)

        original = subprocess.run
        subprocess.run = fake_run
        try:
            protect(1001, 1400 * 1024 * 1024)
            limit(1001, False)
        finally:
            subprocess.run = original
        held = ' '.join(recorded[0])
        idle_args = ' '.join(recorded[1])
        self.assertIn('MemoryMax=3840M', held)
        self.assertIn('MemoryHigh=1400M', held)
        self.assertIn('CPUQuota=25%', held)
        self.assertNotIn('MemoryMax=512M', held)
        self.assertNotIn('MemoryHigh=448M', held)
        self.assertIn('MemoryMax=512M', idle_args)

    def _gate(self, usage, reclaims=None, workers=None, drop=0):
        calls = []

        def record(uid, active):
            calls.append(('limit', uid, active))

        def reclaim(uid, nbytes):
            if reclaims is not None:
                reclaims.append((uid, nbytes))
                if drop:
                    usage['bytes'] = max(0, usage['bytes'] - drop)

        gate = Admission([1001, 1003], record, lambda pid, uid: f'{pid}',
                         usage=lambda uid: usage['bytes'], reclaimer=reclaim,
                         protector=lambda uid, current: calls.append(('protect', uid, current)),
                         worker_running=lambda uid: bool(workers and workers(uid)),
                         no_progress_limit=3, available=lambda: 1 << 62,
                         light_running=lambda: False, light_configured=lambda: False,
                         heavy_slots=1)
        return gate, calls

    def test_reclaim_makes_progress_then_idles_without_a_second_heavy(self):
        usage = {'bytes': 0}
        reclaims = []
        gate, calls = self._gate(usage, reclaims, drop=1200 * 1024 * 1024)
        stamp = gate.acquire(1001, 42)
        usage['bytes'] = 1400 * 1024 * 1024
        marked = len(calls)
        gate.release(1001, 42, stamp)
        self.assertIsNone(gate.lease)
        self.assertTrue(reclaims)
        self.assertNotIn(1001, gate.held)
        self.assertIn(('limit', 1001, False), calls[marked:])
        ready = threading.Event()

        def other():
            gate.acquire(1003, 43)
            ready.set()

        thread = threading.Thread(target=other)
        thread.start()
        self.assertTrue(ready.wait(2))
        thread.join(2)

    def test_waiting_worker_does_not_block_drain_of_the_admitted_worker(self):
        usage = {'bytes': 0}
        reclaims = []
        # pid 99 is a new pre-admission worker. It must not freeze the drain.
        waiting = {'pids': {99}}
        gate, calls = self._gate(usage, reclaims, drop=500 * 1024 * 1024,
                                 workers=lambda uid: bool(waiting['pids']))
        stamp = gate.acquire(1001, 42)
        usage['bytes'] = 900 * 1024 * 1024
        self.assertFalse(gate.drain(1001))
        self.assertIsNotNone(gate.lease)
        self.assertEqual(reclaims, [])
        gate.release(1001, 42, stamp)
        self.assertTrue(reclaims)
        self.assertNotIn(1001, gate.held)
        ready = threading.Event()

        def queued():
            gate.acquire(1001, 99)
            ready.set()

        thread = threading.Thread(target=queued)
        thread.start()
        self.assertTrue(ready.wait(2))
        thread.join(2)
        self.assertEqual(gate.lease, (1001, 99, '99'))

    def test_no_progress_stops_reclaim_and_does_not_admit_another_heavy(self):
        usage = {'bytes': 0}
        reclaims = []
        gate, calls = self._gate(usage, reclaims, drop=0)
        stamp = gate.acquire(1001, 42)
        usage['bytes'] = 2 * 1024 ** 3
        marked = len(calls)
        gate.release(1001, 42, stamp)
        self.assertGreaterEqual(len(reclaims), 1)
        extra = len(reclaims)
        for _ in range(5):
            self.assertFalse(gate.drain(1001))
        self.assertLessEqual(len(reclaims) - extra, 3)
        self.assertIn(1001, gate.stuck)
        self.assertIn(1001, gate.held)
        self.assertNotIn(('limit', 1001, False), calls[marked:])
        ready = threading.Event()

        def other():
            gate.acquire(1003, 43)
            ready.set()

        thread = threading.Thread(target=other)
        thread.start()
        self.assertFalse(ready.wait(.2))
        usage['bytes'] = 200 * 1024 * 1024
        self.assertTrue(gate.drain(1001))
        self.assertTrue(ready.wait(2))
        thread.join(2)
        self.assertIn('do not kill dockerd', RECOVERY)
        self.assertIn('do not admit a second heavy job', RECOVERY)

    def test_startup_does_not_shrink_a_live_or_fat_account(self):
        calls = []
        gate = Admission([1001, 1003], lambda *args: calls.append(args), lambda pid, uid: str(pid),
                         usage=lambda uid: 3 * 1024 ** 3,
                         worker_running=lambda uid: uid == 1001)
        self.assertEqual(calls, [])
        self.assertNotIn(1001, gate.held)
        self.assertIn(1003, gate.held)
        self.assertIsNone(gate.lease)
        with self.assertRaises(TimeoutError):
            gate.acquire(1003, 43, timeout=0.2)
        self.assertEqual(calls, [])
        idle = Admission([1003], lambda *args: calls.append(('idle', args)), lambda pid, uid: 'stamp',
                         usage=lambda uid: 235 * 1024 * 1024)
        self.assertNotIn(1003, idle.held)
        self.assertIn(('idle', (1003, False)), calls)

    def test_startup_restores_a_persisted_lease_without_retuning_caps(self):
        directory = tempfile.mkdtemp()
        path = os.path.join(directory, 'heavy-lease')
        with open(path, 'w') as handle:
            handle.write('1001 42 stamp\n')
        calls = []
        alive = {'stamp': 'stamp'}
        gate = Admission([1001, 1003], lambda *args: calls.append(args),
                         lambda pid, uid: alive['stamp'],
                         usage=lambda uid: 3 * 1024 ** 3,
                         worker_running=lambda uid: True,
                         reclaimer=lambda uid, nbytes: None,
                         protector=lambda uid, current: None,
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=1,
                         status_path=path)
        self.assertEqual(gate.lease, (1001, 42, 'stamp'))
        self.assertEqual(gate.held, {1001})
        self.assertEqual(calls, [])
        with self.assertRaises(TimeoutError):
            gate.acquire(1003, 43, timeout=0.2)
        self.assertEqual(calls, [])
        alive['stamp'] = 'gone'
        gate.release_if_worker_gone()
        self.assertIsNone(gate.lease)
        self.assertIn(1001, gate.held)
        self.assertNotIn((1001, False), calls)

    def test_light_identity_cannot_take_the_heavy_lease(self):
        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: 'stamp')
        with self.assertRaises(ValueError):
            gate.acquire(1004, 7)

    def test_configured_sum_is_one_heavy_one_idle_one_light_and_control(self):
        self.assertEqual(ACTIVE_MAX_MIB, 3840)
        self.assertEqual(IDLE_MAX_MIB, 512)
        self.assertEqual(LIGHT_MAX_MIB, 768)
        self.assertEqual(CONTROL_MAX_MIB, 512)
        self.assertEqual(MARGIN_MIB, 64)
        self.assertEqual(simultaneous_mib(), 9472)
        self.assertEqual(HOST_MIB - simultaneous_mib(), 3840)
        self.assertEqual(HOST_MIB, 13312)
        self.assertGreaterEqual(HOST_MIB - simultaneous_mib(), 3 * 1024)
        self.assertFalse(slice_within_idle(1350 * 1024 * 1024))
        self.assertTrue(slice_within_idle(235 * 1024 * 1024))
        self.assertFalse(slice_within_idle(510881792))
        self.assertTrue(slice_within_idle(448 * 1024 * 1024))
        self.assertEqual(reclaim_needed(510881792), 510881792 - 448 * 1024 * 1024)
        self.assertGreater(reclaim_needed(510881792), 0)

    def test_487_mib_band_reclaims_toward_the_floor_instead_of_writing_zero(self):
        usage = {'bytes': 0}
        reclaims = []

        def reclaim(uid, nbytes):
            reclaims.append(nbytes)

        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: f'{pid}',
                         usage=lambda uid: usage['bytes'], reclaimer=reclaim,
                         protector=lambda uid, current: None, no_progress_limit=6,
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=1)
        stamp = gate.acquire(1001, 42)
        usage['bytes'] = 510881792
        gate.release(1001, 42, stamp)
        for _ in range(8):
            gate.drain(1001)
        self.assertGreaterEqual(len(reclaims), 6)
        self.assertTrue(all(nbytes > 0 for nbytes in reclaims[:6]))
        self.assertEqual(reclaims[0], 510881792 - 448 * 1024 * 1024)
        self.assertIn(1001, gate.held)
        with self.assertRaises(TimeoutError):
            gate.acquire(1003, 43, timeout=0.2)

    def test_487_mib_band_releases_the_slot_when_reclaim_reaches_the_floor(self):
        usage = {'bytes': 0}

        def reclaim(uid, nbytes):
            usage['bytes'] = max(0, usage['bytes'] - nbytes)

        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: f'{pid}',
                         usage=lambda uid: usage['bytes'], reclaimer=reclaim,
                         protector=lambda uid, current: None,
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=1)
        stamp = gate.acquire(1001, 42)
        usage['bytes'] = 510881792
        gate.release(1001, 42, stamp)
        self.assertLessEqual(usage['bytes'] + 64 * 1024 * 1024, 512 * 1024 * 1024)
        self.assertNotIn(1001, gate.held)
        self.assertIsNotNone(gate.acquire(1003, 43, timeout=1))

    def test_reclaim_file_writes_the_floor_overshoot(self):
        root = tempfile.mkdtemp()
        target = os.path.join(root, 'user.slice', 'user-1001.slice')
        os.makedirs(target)
        path = os.path.join(target, 'memory.reclaim')
        os.close(os.open(path, os.O_CREAT | os.O_WRONLY, 0o200))
        nbytes = reclaim_needed(510881792)
        reclaim_file_cache(1001, nbytes, root=root)
        os.chmod(path, 0o644)
        with open(path) as handle:
            written = handle.read()
        self.assertEqual(written, f'{nbytes}\n')
        self.assertNotEqual(written, '0\n')

    def test_idle_host_does_not_admit_light_on_a_256_mib_heavy_stub(self):
        mib = 1024 * 1024
        available = 4710 * mib
        build = 487 * mib
        release = 254 * mib
        self.assertFalse(light_headroom_ok(available, build, release, active=None))
        self.assertFalse(light_headroom_ok(available, build, release, active='build'))
        self.assertGreaterEqual(available, (256 + 768 + 1792) * mib)
        self.assertFalse(light_headroom_ok(3277 * mib, 3584 * mib, 254 * mib, active='build'))
        self.assertTrue(light_headroom_ok(5200 * mib, 3584 * mib, 254 * mib, active='build'))
        self.assertFalse(light_headroom_ok(3277 * mib, 3584 * mib, 254 * mib, active=None))
        self.assertFalse(light_headroom_ok(2200 * mib, 2000 * mib, 1800 * mib, active=None))

    def test_heavy_raise_uses_the_same_reserve_while_light_is_running(self):
        mib = 1024 * 1024
        state = {'light': True, 'available': 4710 * mib}

        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: f'{pid}',
                         usage=lambda uid: 254 * mib,
                         available=lambda: state['available'],
                         light_running=lambda: state['light'],
                         light_configured=lambda: True,
                         heavy_slots=1)
        with self.assertRaises(TimeoutError):
            gate.acquire(1001, 42, timeout=0.3)
        self.assertTrue(any(line.startswith('oren-ci admission heavy deny') for line in gate.events))
        self.assertIsNone(gate.lease)
        state['light'] = False
        state['available'] = 1 << 62
        self.assertIsNotNone(gate.acquire(1001, 42, timeout=1))

    def test_production_constructor_does_not_treat_memory_as_unlimited(self):
        import admission as mod
        originals = (mod.read_mem_available, mod.light_account_has_worker, mod.light_account_configured)
        mod.read_mem_available = lambda: 100 * 1024 * 1024
        mod.light_account_has_worker = lambda: True
        mod.light_account_configured = lambda: True
        try:
            gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: str(pid),
                             usage=lambda uid: 254 * 1024 * 1024,
                             worker_running=lambda uid: False, heavy_slots=2)
            with self.assertRaises(TimeoutError):
                gate.acquire(1001, 42, timeout=0.25)
            self.assertEqual(gate.leases, {})
            self.assertTrue(any('heavy deny' in line for line in gate.events))
        finally:
            (mod.read_mem_available, mod.light_account_has_worker,
             mod.light_account_configured) = originals

    def test_unreadable_memory_denies_the_raise(self):
        def boom():
            raise OSError('meminfo missing')

        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: str(pid),
                         usage=lambda uid: 0, available=boom, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=2)
        with self.assertRaises(TimeoutError):
            gate.acquire(1001, 42, timeout=0.25)
        self.assertEqual(gate.leases, {})
        self.assertTrue(any('meminfo missing' in line for line in gate.events))

    def test_two_heavy_slots_keep_separate_caps_and_block_a_third(self):
        calls = []

        def limit(uid, active):
            calls.append((uid, active))

        gate = Admission([1001, 1003, 1005], limit, lambda pid, uid: str(pid),
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: False, heavy_slots=2)
        gate.acquire(1001, 42)
        gate.acquire(1003, 43)
        self.assertEqual(set(gate.leases), {1001, 1003})
        self.assertIn((1001, True), calls)
        self.assertIn((1003, True), calls)
        self.assertNotIn((1001, False), calls[calls.index((1001, True)) + 1:])
        ready = threading.Event()

        def third():
            try:
                gate.acquire(1005, 44, timeout=0.3)
            except TimeoutError:
                return
            ready.set()

        thread = threading.Thread(target=third)
        thread.start()
        self.assertFalse(ready.wait(0.5))
        thread.join(1)
        self.assertNotIn(1005, gate.leases)

    def test_light_permit_and_heavy_raise_share_one_snapshot(self):
        mib = 1024 * 1024
        state = {'inside': 0, 'max': 0}
        guard = threading.Lock()

        def available():
            with guard:
                state['inside'] += 1
                state['max'] = max(state['max'], state['inside'])
            time.sleep(0.02)
            with guard:
                state['inside'] -= 1
            return 8000 * mib

        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: str(pid),
                         usage=lambda uid: 200 * mib, available=available,
                         light_running=lambda: False, light_configured=lambda: True,
                         light_uid=1004, light_identity=lambda pid, uid: f'L{pid}',
                         heavy_slots=2)
        results = []

        def heavy():
            try:
                gate.acquire(1001, 42, timeout=1)
            except TimeoutError:
                results.append('no-heavy')
                return
            results.append('heavy')

        def light():
            try:
                gate.acquire_light(77, timeout=1)
            except TimeoutError:
                results.append('no-light')
                return
            results.append('light')

        threads = [threading.Thread(target=heavy), threading.Thread(target=light)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(3)
        self.assertLessEqual(state['max'], 1)
        self.assertIn('heavy', results)
        self.assertNotIn('light', results)
        self.assertIsNone(gate.light_lease)

    def test_restart_restores_a_live_light_permit_and_does_not_grant_another(self):
        directory = tempfile.mkdtemp()
        path = os.path.join(directory, 'light-lease')
        with open(path, 'w') as handle:
            handle.write('1004 77 stamp\n')
        alive = {'stamp': 'stamp'}

        def identity(pid, uid):
            return alive['stamp'] if pid == 77 else 'other'

        gate = Admission([1001], lambda *args: None, lambda pid, uid: str(pid),
                         available=lambda: 1 << 62, light_running=lambda: False,
                         light_configured=lambda: True, light_uid=1004,
                         light_identity=identity, light_status_path=path,
                         heavy_slots=2)
        self.assertEqual(gate.light_lease, (77, 'stamp'))
        with self.assertRaises(TimeoutError):
            gate.acquire_light(88, timeout=0.25)
        self.assertEqual(gate.light_lease, (77, 'stamp'))
        alive['stamp'] = 'gone'
        gate.release_if_light_gone()
        self.assertIsNone(gate.light_lease)
        with open(path) as handle:
            self.assertEqual(handle.read(), '')
        granted = gate.acquire_light(88, timeout=1)
        self.assertEqual(gate.light_lease[0], 88)
        with open(path) as handle:
            self.assertIn('1004 88 ', handle.read())
        self.assertTrue(granted)

    def test_reclaim_eagain_does_not_starve_the_other_slot(self):
        usage = {1001: 0, 1003: 0, 1005: 0}

        calls = {'block': True}

        def reclaim(uid, nbytes):
            if calls['block']:
                raise BlockingIOError(11, 'write could not complete without blocking')
            usage[uid] = 200 * 1024 * 1024

        gate = Admission([1001, 1003, 1005], lambda *args: None, lambda pid, uid: str(pid),
                         usage=lambda uid: usage[uid], reclaimer=reclaim,
                         protector=lambda uid, current: None, no_progress_limit=2,
                         reclaim_timeout=0.5, reclaim_retry=0, available=lambda: 1 << 62,
                         light_running=lambda: False, light_configured=lambda: False,
                         heavy_slots=2)
        stamp = gate.acquire(1001, 42)
        usage[1001] = 2 * 1024 ** 3
        started = time.monotonic()
        gate.release(1001, 42, stamp)
        for _ in range(3):
            self.assertFalse(gate.drain(1001))
        self.assertLess(time.monotonic() - started, 3)
        self.assertIn(1001, gate.stuck)
        self.assertIn(1001, gate.held)
        slot = time.monotonic()
        self.assertIsNotNone(gate.acquire(1003, 43, timeout=1))
        self.assertLess(time.monotonic() - slot, 1)
        with self.assertRaises(TimeoutError):
            gate.acquire(1005, 44, timeout=0.3)
        calls['block'] = False
        self.assertTrue(gate.drain(1001))
        self.assertNotIn(1001, gate.held)
        self.assertIsNotNone(gate.acquire(1005, 44, timeout=1))

    def test_hung_reclaim_returns_and_the_other_slot_still_admits(self):
        usage = {1001: 0, 1003: 0}

        def reclaim(uid, nbytes):
            time.sleep(30)

        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: str(pid),
                         usage=lambda uid: usage[uid], reclaimer=reclaim,
                         protector=lambda uid, current: None, no_progress_limit=1,
                         reclaim_timeout=0.2, available=lambda: 1 << 62,
                         light_running=lambda: False, light_configured=lambda: False,
                         heavy_slots=2)
        stamp = gate.acquire(1001, 42)
        usage[1001] = 2 * 1024 ** 3
        started = time.monotonic()
        gate.release(1001, 42, stamp)
        self.assertLess(time.monotonic() - started, 2)
        self.assertIn(1001, gate.held)
        self.assertFalse(gate.drain(1001))
        self.assertIsNotNone(gate.acquire(1003, 43, timeout=1))

    def test_dead_worker_is_cleared_while_reclaim_is_hung(self):
        usage = {1001: 0, 1003: 0, 1005: 0}
        alive = {42, 43}

        def reclaim(uid, nbytes):
            time.sleep(30)

        def identity(pid, uid):
            if pid == 42 and pid not in alive:
                raise OSError('worker gone')
            return str(pid)

        gate = Admission([1001, 1003, 1005], lambda *args: None, identity,
                         usage=lambda uid: usage[uid], reclaimer=reclaim,
                         protector=lambda uid, current: None, no_progress_limit=6,
                         reclaim_timeout=0.2, available=lambda: 1 << 62,
                         light_running=lambda: False, light_configured=lambda: False,
                         heavy_slots=2)
        gate.acquire(1001, 42)
        gate.acquire(1003, 43)
        usage[1001] = 2 * 1024 ** 3
        alive.remove(42)
        started = time.monotonic()
        gate.release_if_worker_gone()
        self.assertLess(time.monotonic() - started, 2)
        self.assertNotIn(1001, gate.leases)
        self.assertIn(1001, gate.held)
        self.assertIn(1003, gate.leases)
        with self.assertRaises(TimeoutError):
            gate.acquire(1005, 44, timeout=0.3)

    def test_dead_light_permit_clears_while_heavy_reclaim_is_hung(self):
        directory = tempfile.mkdtemp()
        light_path = os.path.join(directory, 'light-lease')
        with open(light_path, 'w') as handle:
            handle.write('1005 1553788 3712540\n')
        usage = {1001: 2 * 1024 ** 3, 1003: 0}
        entered = threading.Event()

        def reclaim(uid, nbytes):
            entered.set()
            time.sleep(30)

        def identity(pid, uid):
            raise OSError('worker gone')

        def light_identity(pid, uid):
            if pid == 1553788:
                raise OSError('light worker gone')
            return str(pid)

        gate = Admission([1001, 1003], lambda *args: None, identity,
                         usage=lambda uid: usage[uid], reclaimer=reclaim,
                         protector=lambda uid, current: None, no_progress_limit=6,
                         reclaim_timeout=0.2, available=lambda: 1 << 62,
                         light_running=lambda: False, light_configured=lambda: True,
                         heavy_slots=2, light_uid=1005, light_identity=light_identity,
                         light_status_path=light_path, light_usage=lambda: 283 * 1024 * 1024,
                         control_usage=lambda: 0)
        self.assertIsNone(gate.light_lease)
        gate.leases[1001] = (42, '42')
        gate.held.add(1001)
        gate.light_lease = (1553788, '3712540')
        result = {}

        def waiter():
            try:
                result['stamp'] = gate.acquire_light(1934397, timeout=2)
            except Exception as error:
                result['error'] = error

        thread = threading.Thread(target=waiter)
        thread.start()
        self.assertTrue(thread.is_alive())
        started = time.monotonic()
        gate.reap_once()
        self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(entered.is_set())
        thread.join(2)
        self.assertEqual(result.get('stamp'), '1934397')
        self.assertNotIn(1001, gate.leases)
        self.assertIn(1001, gate.held)
        with open(light_path) as handle:
            self.assertEqual(handle.read().split(), ['1005', '1934397', '1934397'])

    def test_status_directory_stays_traversable_under_service_umask(self):
        parent = tempfile.mkdtemp()
        path = os.path.join(parent, 'oren-ci-status')
        previous = os.umask(0o077)
        try:
            ensure_public_dir(path)
        finally:
            os.umask(previous)
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o755)


if __name__ == '__main__':
    unittest.main()
