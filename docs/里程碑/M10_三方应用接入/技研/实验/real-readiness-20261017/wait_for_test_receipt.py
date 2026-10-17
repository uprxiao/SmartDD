#!/usr/bin/env python3
"""Observe local Foxmail delivery of the one approved test without fetching POP."""
import datetime as dt
import argparse
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import sqlite3
import time


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--after-confirmed-client-receive',action='store_true')
    args=parser.parse_args()
    here=Path(__file__).resolve().parent
    sent=json.loads((here/'smtp-send-once-result.json').read_text())
    if sent['status']!='server_accepted':raise SystemExit('No accepted test message; no receipt claim.')
    mid=sent['messageID']; root=Path('/Users/liubu/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail/Profiles')
    report={'schema':'m10-foxmail-approved-test-receipt-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'messageID':mid,'sourceReadOnly':True,'popConnectionTriggeredByObserver':False,
            'userConfirmedClientReceiveTriggered':args.after_confirmed_client_receive,'sourceContentSaved':False,
            'status':'not_observed','observationBudgetSeconds':120,'checks':0}
    started=time.monotonic()
    while time.monotonic()-started<120:
        report['checks']+=1
        for p in root.iterdir():
            if not p.is_dir() or p.is_symlink():continue
            c=sqlite3.connect((p/'messages.db').as_uri()+'?mode=ro',uri=True,timeout=1);c.execute('PRAGMA query_only=ON')
            rows=c.execute('SELECT mailid,subject FROM mailinfo WHERE messageid=? OR messageid=?',(mid,mid.strip('<>'))).fetchall();c.close()
            if not rows:continue
            report['matchingIndexRows']=len(rows)
            native_id=rows[0][0]
            files=list((p/'Mail').rglob(str(native_id)+'.mail'))
            report['matchingSourceFileCount']=len(files)
            if len(files)!=1 or files[0].is_symlink():continue
            data=files[0].read_bytes()
            if len(data)>1024*1024:raise RuntimeError('Unexpected test message size')
            msg=BytesParser(policy=policy.default).parsebytes(data)
            plain=msg.get_body(preferencelist=('plain',))
            content=plain.get_content() if plain else ''
            expected='这是一封用于验证 WillYou M10 邮件发送与本地接收的测试邮件。\n无需回复，无附件。'
            report.update(status='observed_in_local_foxmail',
                          sourceMessageIDMatches=str(msg['Message-ID'])==mid,
                          subjectMatchesApprovedDraft=str(msg['Subject'])==sent['subject'],
                          approvedBodyPresent=expected in content.replace('\r\n','\n'),
                          attachmentCount=len(list(msg.iter_attachments())),sourceFileBytes=len(data))
            break
        if report['status']=='observed_in_local_foxmail':break
        if report['checks']%5==1:print(json.dumps({'receiptObservation':'waiting_for_normal_Foxmail_receive','checks':report['checks']}),flush=True)
        time.sleep(3)
    report['elapsedSeconds']=round(time.monotonic()-started,3)
    (here/'foxmail-test-receipt-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
