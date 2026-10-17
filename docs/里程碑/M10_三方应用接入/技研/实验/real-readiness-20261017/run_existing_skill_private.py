#!/usr/bin/env python3
"""Run the real old Skill and verifier; keep business artifacts in ignored storage."""
import datetime as dt
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import time
sys.dont_write_bytecode=True
from zentao_read_probe import BASE, EXPECTED_ACCOUNT, SKILL, ZenTaoClient


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--bug-id',action='append',default=[])
    parser.add_argument('--user-verified-complete-page',action='store_true')
    args=parser.parse_args()
    if any(not x.isdecimal() for x in args.bug_id) or len(args.bug_id)>10:
        raise SystemExit('Only up to 10 explicitly provided numeric Bug IDs are allowed.')
    for key in ['NO_PROXY','no_proxy']:os.environ[key]=os.environ.get(key,'')+',192.168.106.185'
    targeted=bool(args.bug_id)
    name='zentao-private-targeted' if targeted else 'zentao-private-export'
    log_prefix='targeted-export' if targeted else 'export'
    root=Path.cwd()/'release/m10-research/live-verification-20261017'/name
    if root.exists():raise SystemExit('Private export already exists; review before another run.')
    root.parent.mkdir(parents=True,exist_ok=True);os.chmod(root.parent,0o700)
    secret=getpass.getpass('禅道现有密码（隐藏输入）: ')
    client=ZenTaoClient(BASE,timeout=8,retries=1)
    report={'schema':'m10-real-existing-skill-export-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'scope':'explicit user-page IDs' if targeted else 'assigned to existing bound account; all accessible product inventory',
            'selectionMode':'direct_ids' if targeted else 'mine_inventory',
            'userPageScopeEvidenceProvided':args.user_verified_complete_page,
            'privateBusinessArtifacts':str(root.relative_to(Path.cwd())),
            'credentialsSavedOrPrinted':False,'businessWrites':0,'exporterUnmodified':True,'verifierUnmodified':True}
    start=time.monotonic()
    try:
        token=client.authenticate(EXPECTED_ACCOUNT,secret);secret=''
        env={k:v for k,v in os.environ.items() if not k.startswith('ZENTAO_')}
        env.update({'ZENTAO_TOKEN':token,'PYTHONDONTWRITEBYTECODE':'1','NO_PROXY':'*','no_proxy':'*'})
        cmd=[sys.executable,str(SKILL/'scripts/export_bugs.py'),'--base-url',BASE,
             '--username',EXPECTED_ACCOUNT,'--zentao-version','企业版 13.0','--mine','assigned',
             '--output',str(root),'--include-inline','--save-raw','--timeout','8','--retries','1','--page-size','1000']
        for bug_id in args.bug_id:cmd.extend(['--bug-id',bug_id])
        if targeted and args.user_verified_complete_page:
            cmd.extend(['--verified-scope-count',str(len(set(args.bug_id))),'--verified-scope-source',
                        'User supplied the current assigned-to-me page complete ID list for this verification on 2026-10-17.'])
        for name in [log_prefix+'.stdout.log',log_prefix+'.stderr.log']:
            p=root.parent/name;p.touch(mode=0o600,exist_ok=False);os.chmod(p,0o600)
        print('开始运行既有 Skill 的限定只读导出。',flush=True)
        with (root.parent/(log_prefix+'.stdout.log')).open('w') as out,(root.parent/(log_prefix+'.stderr.log')).open('w') as err:
            completed=subprocess.run(cmd,env=env,stdout=out,stderr=err,timeout=600)
        report['exportExitCode']=completed.returncode
        if (root/'manifest.json').exists():
            m=json.loads((root/'manifest.json').read_text())
            report['manifestBooleanResults']={k:m.get(k) for k in ['complete','artifact_complete','scope_complete']}
            report['manifestTopLevelKeys']=sorted(m)
            for k in ['counts','statistics','summary']:
                if isinstance(m.get(k),dict):
                    report[k]={key:value for key,value in m[k].items() if isinstance(value,(int,bool))}
            report['bugManifestCount']=sum(1 for p in (root/'bugs').glob('*/manifest.json'))
            verified=subprocess.run([sys.executable,str(SKILL/'scripts/verify_export.py'),'--json',str(root)],env=env,capture_output=True,text=True,timeout=60)
            report['verifierExitCode']=verified.returncode
            try:
                v=json.loads(verified.stdout)
                report['verifier']={k:val for k,val in v.items() if isinstance(val,(bool,int))}
                report['verifierErrorCount']=len(v.get('errors',[]))
            except Exception:report['verifierOutputParsed']=False
        report['status']='completed' if report.get('verifierExitCode')==0 and all(report.get('manifestBooleanResults',{}).values()) else 'failed_or_partial'
    except Exception as exc:
        report.update(status='failed_or_partial',errorType=type(exc).__name__)
        if getattr(exc,'status_code',None) is not None:report['httpStatus']=exc.status_code
    finally:
        client.clear_token();secret=''
        report['elapsedSeconds']=round(time.monotonic()-start,3)
        report['limits']=['Skill Bug export only; Story and state transitions are separate tests.',
                          'Private raw exports and logs are not staged or copied into docs.']
        path=Path(__file__).with_name('existing-skill-targeted-result.json' if targeted else 'existing-skill-export-result.json')
        path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
