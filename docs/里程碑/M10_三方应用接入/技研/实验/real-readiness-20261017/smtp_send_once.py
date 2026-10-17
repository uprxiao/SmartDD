#!/usr/bin/env python3
"""Send the exact user-approved self-test draft once; never automatically retry."""
import argparse
import datetime as dt
from email import policy
from email.parser import BytesParser
import getpass
import hashlib
import json
from pathlib import Path
import smtplib


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--draft',type=Path,required=True)
    ap.add_argument('--expected-sha256',required=True)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    if args.output.exists():
        raise SystemExit('Existing send intent found; refuse automatic duplicate submission.')
    raw=args.draft.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=args.expected_sha256:
        raise SystemExit('Reviewed draft changed; no send attempted.')
    msg=BytesParser(policy=policy.default).parsebytes(raw)
    sender=str(msg['From']); recipient=str(msg['To'])
    if sender!=recipient or msg['Cc'] or msg['Bcc'] or len(list(msg.iter_attachments())):
        raise SystemExit('Draft is outside the approved one-recipient, self-test, no-attachment scope.')
    report={'schema':'m10-approved-smtp-send-once-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'host':'mail.ultrapower.com.cn','port':587,'userApprovedExactDraft':True,
            'draftSha256':args.expected_sha256,'messageID':str(msg['Message-ID']),
            'recipientScope':'same confirmed mailbox as authenticated sender',
            'subject':str(msg['Subject']),'attachmentCount':0,'credentialsSavedOrPrinted':False,
            'sendAttempts':0,'status':'prepared','localFoxmailReceipt':'not_yet_checked'}
    secret=getpass.getpass('邮箱现有密码／授权码（隐藏输入）: ')
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    client=None
    try:
        client=smtplib.SMTP(report['host'],report['port'],timeout=8,local_hostname='willyou-m10.local')
        client.ehlo()
        code,_=client.login(sender,secret)
        secret=''
        report['authenticationCode']=code
        report.update(status='submission_started',sendAttempts=1)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        refused=client.sendmail(sender,[recipient],raw)
        report.update(status='server_accepted',refusedRecipientCount=len(refused),
                      deliveryToMailboxConfirmed=False)
    except Exception as exc:
        report['errorType']=type(exc).__name__
        report['status']='result_unknown' if report['sendAttempts'] else 'failed_before_submission'
        if isinstance(exc,smtplib.SMTPResponseException):
            report['smtpErrorCode']=exc.smtp_code
            if isinstance(exc,smtplib.SMTPDataError):
                report['status']='server_rejected_data'
    finally:
        secret=''
        if client:
            try:client.quit()
            except Exception:client.close()
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
