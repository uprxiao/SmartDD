#!/usr/bin/env python3
"""Inspect or temporarily verify MTU for the single approved ZenTao IPv4 route.

Default: read-only. --temporary-test requires macOS administrator privileges,
changes only this host route, probes anonymous resources, then restores MTU.
No password/token/cookie handling and no persistent VPN configuration changes.
"""
import argparse
import datetime
import http.client
import json
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import time

HOST = '192.168.106.185'
EXPECTED_INTERFACE = 'utun5'
EXPECTED_MTU = 1420
TEST_MTU = 1200
ROUTE = '/sbin/route'
# Apple's SDK defines this option as 0x106; system Python 3.9 omits its name.
TCP_CONNECTION_INFO = getattr(socket, 'TCP_CONNECTION_INFO', 0x106)


def route_state():
    p = subprocess.run([ROUTE, '-n', 'get', HOST], check=True,
                       capture_output=True, text=True, timeout=5)
    interface = re.search(r'^\s*interface:\s*(\S+)', p.stdout, re.M)
    metrics = re.search(r'^\s*(recvpipe\s+sendpipe[^\n]*)\n([^\n]+)',
                        p.stdout, re.M)
    if not interface or not metrics:
        raise RuntimeError('Unable to verify the exact existing host route')
    values = dict(zip(metrics[1].split(), metrics[2].split()))
    return {'host': HOST, 'interface': interface[1], 'mtu': int(values['mtu'])}


def change_mtu(mtu):
    # Keep the existing VPN interface/gateway; change only this IPv4 host MTU.
    subprocess.run([ROUTE, '-n', 'change', '-host', HOST, '-mtu', str(mtu)],
                   check=True, capture_output=True, timeout=5)


def probe(path, byte_range=None):
    row = {'path': path, 'range': byte_range}
    start = time.monotonic()
    s = socket.socket()
    try:
        s.settimeout(3)
        s.connect((HOST, 80))
        row['connectedMs'] = round((time.monotonic() - start) * 1000)
        v = struct.unpack_from('@BBBB13I7Q', s.getsockopt(
            socket.IPPROTO_TCP, TCP_CONNECTION_INFO, 256))
        row['tcpOptions'] = v[4]
        row['maxseg'] = v[7]
        extra = f'Range: {byte_range}\r\n' if byte_range else ''
        s.sendall((f'GET {path} HTTP/1.1\r\nHost: {HOST}\r\n'
                   f'User-Agent: WillYou/Applications\r\nAccept: */*\r\n'
                   f'{extra}Connection: close\r\n\r\n').encode('ascii'))
        s.settimeout(max(.01, 5 - (time.monotonic() - start)))
        response = http.client.HTTPResponse(s)
        response.begin()
        row['status'] = response.status
        row['firstByteMs'] = round((time.monotonic() - start) * 1000)
        row['bodyBytes'] = len(response.read(65537))
    except Exception as error:
        row['errorClass'] = type(error).__name__
    finally:
        s.close()
        row['elapsedMs'] = round((time.monotonic() - start) * 1000)
    return row


def stop(_signum, _frame):
    raise SystemExit('Interrupted; restoring the verified original MTU')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--temporary-test', action='store_true')
    args = parser.parse_args()
    result = {'revision': 'r2-system-python39',
              'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'one existing approved IPv4 host route;anonymous probes',
              'configurationChanged': False, 'status': 'inspected'}
    result['before'] = route_state()
    if not args.temporary_test:
        print(json.dumps(result, indent=2))
        return 0
    if os.geteuid() != 0:
        result.update(status='administrator-required',
                      reason='macOS route changes require administrator privileges')
        print(json.dumps(result, indent=2))
        return 2
    if result['before'] != {'host': HOST, 'interface': EXPECTED_INTERFACE,
                            'mtu': EXPECTED_MTU}:
        raise RuntimeError('Route changed since diagnosis;inspect before proceeding')
    signal.signal(signal.SIGTERM, stop)
    try:
        # Restore even if the command completes but its acknowledgement is lost.
        change_mtu(TEST_MTU)
        result['configurationChanged'] = True
        result['during'] = route_state()
        assert result['during'] == {**result['before'], 'mtu': TEST_MTU}
        result['lowMtuChecks'] = [probe('/biz/favicon.ico', 'bytes=0-2047'),
                                  probe('/biz/api.php/v1/user')]
    finally:
        now = route_state()
        if now['interface'] != EXPECTED_INTERFACE:
            raise RuntimeError('VPN route changed;manual restoration must be reviewed')
        if now['mtu'] == TEST_MTU:
            change_mtu(EXPECTED_MTU)
        result['after'] = route_state()
        result['restored'] = result['after'] == result['before']
        print(json.dumps(result, indent=2), flush=True)
        if not result['restored']:
            raise RuntimeError('Original route MTU restoration not confirmed')
    result['restoredControl'] = probe('/biz/favicon.ico', 'bytes=0-2047')
    result['status'] = 'completed'
    print(json.dumps(result, indent=2), flush=True)
    checks = result['lowMtuChecks']
    return 0 if (checks[0].get('status') == 206 and
                 checks[0].get('bodyBytes') == 2048 and
                 checks[1].get('status') == 401) else 1


if __name__ == '__main__':
    sys.exit(main())
