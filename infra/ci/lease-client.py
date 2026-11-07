import socket
import sys

with socket.socket(socket.AF_UNIX) as client:
    client.settimeout(1220)
    client.connect('/run/oren-ci-build/admission.sock')
    client.sendall((str(int(sys.argv[1])) + '\n').encode())
    if client.recv(32) != b'OK\n':
        raise RuntimeError('heavy-job admission failed')
