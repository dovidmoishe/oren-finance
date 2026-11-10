"""Ask admission for the one light permit. Exit nonzero without it.

The heavy lease client is a different socket and a different account.
This process does not decide from its own MemAvailable sample.
"""
import os
import socket
import sys

path = os.environ.get('LIGHT_ADMISSION_SOCK', '/run/oren-ci-status/light-admission.sock')
pid = int(sys.argv[1])
with socket.socket(socket.AF_UNIX) as client:
    client.settimeout(1220)
    try:
        client.connect(path)
    except OSError as error:
        raise SystemExit(f'light admission unavailable: {error}')
    client.sendall(f'{pid}\n'.encode())
    if client.recv(32) != b'OK\n':
        raise SystemExit('light admission denied')
