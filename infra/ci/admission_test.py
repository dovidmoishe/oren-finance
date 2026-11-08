import os
import subprocess
import tempfile
import threading
import unittest
from admission import (
    ACTIVE_MAX_MIB, CONTROL_MAX_MIB, HOST_MIB, IDLE_MAX_MIB, LIGHT_MAX_MIB,
    MARGIN_MIB, NO_PROGRESS_LIMIT, RECOVERY, Admission, heavy_raise_ok, limit,
    light_headroom_ok, protect, reclaim_file_cache, reclaim_needed,
    simultaneous_mib, slice_within_idle, worker_identity,
)


class AdmissionTests(unittest.TestCase):
    def test_budget_order_and_worker_lifetime(self):
        budgets = {}
        calls = []

        def limit(uid, active):
            budgets[uid] = 3840 if active else 512
            calls.append((uid, active))
            self.assertLessEqual(sum(budgets.values()), 4352)

        gate = Admission([1001, 1003], limit, lambda pid, uid: str(pid))
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
        gate = Admission([1001, 1003], limit, lambda pid, uid: 'stamp')
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
                         no_progress_limit=3)
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
        self.assertEqual(simultaneous_mib(), 5632)
        self.assertEqual(HOST_MIB - simultaneous_mib(), 1792)
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
                         protector=lambda uid, current: None, no_progress_limit=6)
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
                         protector=lambda uid, current: None)
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
        self.assertTrue(light_headroom_ok(3277 * mib, 3584 * mib, 254 * mib, active='build'))
        self.assertFalse(light_headroom_ok(3277 * mib, 3584 * mib, 254 * mib, active=None))
        self.assertFalse(light_headroom_ok(2200 * mib, 2000 * mib, 1800 * mib, active=None))

    def test_heavy_raise_uses_the_same_reserve_while_light_is_running(self):
        mib = 1024 * 1024
        self.assertFalse(heavy_raise_ok(4710 * mib, 254 * mib, True))
        self.assertTrue(heavy_raise_ok(4710 * mib, 254 * mib, False))
        self.assertTrue(heavy_raise_ok(7000 * mib, 3600 * mib, True))
        state = {'light': True}

        gate = Admission([1001, 1003], lambda *args: None, lambda pid, uid: f'{pid}',
                         usage=lambda uid: 254 * mib,
                         available=lambda: 4710 * mib,
                         light_running=lambda: state['light'])
        with self.assertRaises(TimeoutError):
            gate.acquire(1001, 42, timeout=0.3)
        state['light'] = False
        self.assertIsNotNone(gate.acquire(1001, 42, timeout=1))


if __name__ == '__main__':
    unittest.main()
