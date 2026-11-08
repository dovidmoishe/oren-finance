import threading
import unittest
import subprocess
from admission import Admission, limit, worker_identity


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

    def test_release_restores_idle_envelope_for_the_same_worker(self):
        calls = []

        def record(uid, active):
            calls.append((uid, active))

        gate = Admission([1001, 1003], record, lambda pid, uid: f'{pid}-start')
        self.assertEqual(calls, [(1001, False), (1003, False)])
        stamp = gate.acquire(1001, 42)
        self.assertEqual(calls[-1], (1001, True))
        with self.assertRaises(ValueError):
            gate.release(1001, 42, 'reused-pid')
        self.assertEqual(gate.active, (1001, 42, stamp))
        gate.release(1001, 42, stamp)
        self.assertEqual(calls[-1], (1001, False))
        self.assertIsNone(gate.active)
        self.assertEqual(sum(1 for _, active in calls if active), 1)

    def test_limit_commands_keep_idle_and_active_ceilings(self):
        recorded = []

        def fake_run(argv, **kwargs):
            recorded.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0)

        original = subprocess.run
        subprocess.run = fake_run
        try:
            limit(1001, False)
            limit(1001, True)
        finally:
            subprocess.run = original
        (idle, idle_kwargs), (active, active_kwargs) = recorded
        self.assertEqual(idle[:4], ['systemctl', 'set-property', '--runtime', 'user-1001.slice'])
        self.assertTrue(idle_kwargs.get('check') and active_kwargs.get('check'))
        self.assertLessEqual(idle_kwargs.get('timeout'), 15)
        self.assertLessEqual(active_kwargs.get('timeout'), 15)
        for ceiling in ('MemoryMax=512M', 'MemoryHigh=448M', 'CPUQuota=25%', 'MemorySwapMax=0'):
            self.assertIn(ceiling, idle)
        for ceiling in ('MemoryMax=3840M', 'MemoryHigh=3584M', 'CPUQuota=100%', 'MemorySwapMax=0'):
            self.assertIn(ceiling, active)
        self.assertNotIn('MemoryMax=512M', active)


if __name__ == '__main__':
    unittest.main()
