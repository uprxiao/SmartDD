#!/usr/bin/env python3
"""SMTP transport/capability probe; never AUTH, MAIL, RCPT, DATA or send."""
import argparse
import datetime as dt
import json
from pathlib import Path
import smtplib
import socket
import ssl
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', required=True)
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--implicit-tls', action='store_true')
    args = ap.parse_args()
    report = {'schema': 'm10-smtp-transport-poc-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'host': args.host, 'port': args.port, 'credentialsUsed': False, 'messagesSent': 0,
              'commandsPermitted': ['EHLO', 'STARTTLS if offered', 'QUIT'], 'steps': []}
    started = time.monotonic()
    client = None
    try:
        addresses = socket.getaddrinfo(args.host, args.port, type=socket.SOCK_STREAM)
        report['steps'].append({'stage': 'dns', 'addressCount': len(addresses)})
        if args.implicit_tls:
            client = smtplib.SMTP_SSL(host=args.host, port=args.port, timeout=5, local_hostname='willyou-m10.local', context=ssl.create_default_context())
        else:
            client = smtplib.SMTP(host=args.host, port=args.port, timeout=5, local_hostname='willyou-m10.local')
        # The standard-library constructor raises unless the greeting is 220.
        report['steps'].append({'stage': 'connect', 'smtpCode': 220})
        if args.implicit_tls:
            report['tlsStatus'] = 'verified_implicit_tls'
            report['steps'].append({'stage': 'implicit_tls', 'certificateVerification': True,
                                    'tlsVersion': client.sock.version(), 'cipher': client.sock.cipher()[0]})
        code, _ = client.ehlo()
        report['steps'].append({'stage': 'ehlo', 'smtpCode': code,
                                'extensionNames': sorted(client.esmtp_features),
                                'authenticationMethods': client.esmtp_features.get('auth', '').split()})
        if client.has_extn('starttls') and not args.implicit_tls:
            code, _ = client.starttls(context=ssl.create_default_context())
            report['steps'].append({'stage': 'starttls', 'smtpCode': code, 'certificateVerification': True,
                                    'tlsVersion': client.sock.version(), 'cipher': client.sock.cipher()[0]})
            code, _ = client.ehlo()
            report['steps'].append({'stage': 'ehlo_after_tls', 'smtpCode': code,
                                    'authenticationMethods': client.esmtp_features.get('auth', '').split()})
            report['tlsStatus'] = 'verified'
        elif not args.implicit_tls:
            report['tlsStatus'] = 'STARTTLS_not_advertised'
        report['transportStatus'] = 'connected'
    except Exception as exc:
        report['transportStatus'] = 'failed_or_incomplete'
        report['errorType'] = type(exc).__name__
        if isinstance(exc, ssl.SSLCertVerificationError):
            report['certificateVerificationErrorCode'] = exc.verify_code
        elif isinstance(exc, OSError):
            report['errno'] = exc.errno
    finally:
        if client:
            try:
                client.quit()
            except Exception:
                client.close()
    report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    report['limitations'] = ['No credentials or authentication attempt; no mail transaction.',
                             'Reachability/capabilities do not prove account permission or delivery.',
                             'TLS certificate validation was not disabled.']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
