import subprocess
import threading
import unittest
from admission import (
    ACTIVE_MAX_MIB, CONTROL_MAX_MIB, HOST_MIB, IDLE_MAX_MIB, LIGHT_MAX_MIB,
    MARGIN_MIB, NO_PROGRESS_LIMIT, RECOVERY, Admission, limit, protect,
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
        gate = Admission([1001], lambda *args: calls.append(args), lambda pid, uid: 'stamp',
                         usage=lambda uid: 3 * 1024 ** 3, softener=lambda uid: calls.append(('soften', uid)),
                         worker_running=lambda uid: True)
        self.assertEqual(calls, [])
        self.assertEqual(gate.held, {1001})
        self.assertIsNone(gate.lease)
        idle = Admission([1003], lambda *args: calls.append(('idle', args)), lambda pid, uid: 'stamp',
                         usage=lambda uid: 235 * 1024 * 1024,
                         softener=lambda uid: calls.append(('soften-idle', uid)))
        self.assertNotIn(1003, idle.held)
        self.assertIn(('idle', (1003, False)), calls)

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


if __name__ == '__main__':
    unittest.main()
