"""Root-owned heavy-job admission; identity comes from Unix peer credentials."""
import os
import grp
import pwd
import socket
import socketserver
import struct
import subprocess
import threading
import time


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


def limit(uid, active):
    subprocess.run(['systemctl', 'set-property', '--runtime', f'user-{uid}.slice',
                    f'MemoryMax={3840 if active else 512}M',
                    f'MemoryHigh={3584 if active else 448}M',
                    f'CPUQuota={100 if active else 25}%', 'MemorySwapMax=0'],
                   check=True, timeout=15, capture_output=True)


class Admission:
    def __init__(self, users, limiter=limit, identity=worker_identity):
        self.users = users
        self.limiter = limiter
        self.identity = identity
        self.condition = threading.Condition()
        self.active = None
        for uid in users:
            limiter(uid, False)

    def acquire(self, uid, pid, timeout=1200):
        if uid not in self.users:
            raise ValueError('unknown peer')
        stamp = self.identity(pid, uid)
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.active is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('build queue timeout')
                self.condition.wait(min(remaining, 1))
                if self.identity(pid, uid) != stamp:
                    raise ValueError('worker exited while queued')
            # Lower every other account before raising this one. A failed
            # systemctl call fails closed and never admits another build.
            for other in self.users:
                if other != uid:
                    self.limiter(other, False)
            self.limiter(uid, True)
            self.active = (uid, pid, stamp)
        return stamp

    def release(self, uid, pid, stamp):
        with self.condition:
            if self.active != (uid, pid, stamp):
                raise ValueError('lease mismatch')
            self.limiter(uid, False)
            self.active = None
            self.condition.notify_all()


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
        self.server.admission.release(uid, pid, stamp)


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    request_queue_size = 8


if __name__ == '__main__':
    users = [pwd.getpwnam(name).pw_uid for name in ('oren-ci-build', 'oren-ci-release')]
    admission = Admission(users)
    address = '/run/oren-ci-build/admission.sock'
    if os.path.exists(address):
        os.unlink(address)
    with Server(address, Handler) as server:
        server.admission = admission
        os.chown(address, 0, grp.getgrnam('oren-ci-workers').gr_gid)
        os.chmod(address, 0o660)
        server.serve_forever()
