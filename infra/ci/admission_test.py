import threading
import unittest
from admission import Admission, worker_identity


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


if __name__ == '__main__':
    unittest.main()
