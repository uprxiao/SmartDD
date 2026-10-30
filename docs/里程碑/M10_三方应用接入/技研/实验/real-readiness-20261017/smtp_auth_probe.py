#!/usr/bin/env python3
"""Authenticate with explicitly supplied mailbox credentials; never send mail."""
import datetime as dt
import argparse
import getpass
import json
from pathlib import Path
import smtplib
import time

HOST = 'mail.ultrapower.com.cn'
PORT = 587


def run(secret, account):
    report = {'schema': 'm10-smtp-auth-poc-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'host': HOST, 'port': PORT, 'accountFromObservedFoxmailSettings': True,
              'transportMatchesCurrentFoxmail': True, 'transportEncrypted': False,
              'credentialsSavedOrPrinted': False, 'messagesSent': 0,
              'mailRcptDataCommandsUsed': False, 'scope': 'Explicitly authorized existing-configuration login only.'}
    client = None
    started = time.monotonic()
    try:
        client = smtplib.SMTP(HOST, PORT, timeout=6, local_hostname='willyou-m10.local')
        code, _ = client.ehlo()
        report['ehloCode'] = code
        report['starttlsAdvertised'] = client.has_extn('starttls')
        code, _ = client.login(account, secret)
        report.update(authentication='accepted', smtpAuthenticationCode=code)
    except Exception as exc:
        report.update(authentication='failed_or_not_verified', errorType=type(exc).__name__)
        if isinstance(exc, smtplib.SMTPResponseException):
            report['smtpErrorCode'] = exc.smtp_code
    finally:
        if client:
            try:
                client.quit()
            except Exception:
                client.close()
    report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    report['limitations'] = ['Authentication success is not send permission or message delivery evidence.',
                             'The tested current configuration provides no TLS transport encryption.']
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--username', required=True)
    args = parser.parse_args()
    secret = getpass.getpass('邮箱现有密码／授权码（隐藏输入）: ')
    result = run(secret, args.username)
    secret = ''
    path = Path(__file__).with_name('smtp-auth-result.json')
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))
