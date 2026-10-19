from pathlib import Path
import os,json,datetime
folders=['willyou-pdf-controls-A-RqGor6','willyou-pdf-controls-A-j4Pk6k','willyou-pdf-controls-A-Cv7Jo5','willyou-pdf-controls-A-u4Hw9Y','willyou-pdf-controls-P-3Ou5rg','willyou-pdf-controls-A-K65eTC','willyou-pdf-controls-P-JalsSG'];rows=[]
for name in folders:
 p=Path('/private/tmp')/name;r=json.load(open(p/'result.json'));pid=r['pid']
 try:os.kill(pid,0);raise AssertionError((name,pid,'still live'))
 except ProcessLookupError:pass
 rows.append({'folder':str(p),'pid':pid,'pids':[pid],'status':r['status'],'allAbsent':True})
x={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'knownOwnApps':len(rows),'knownOwnProcesses':len(rows),'rows':rows,'boundary':'No actual PTY or model tasks created in any PDF control UI instance; explicit allknownparent PID absence only, no unrecorded Worker/OS-process claim.'};Path('/private/tmp/willyou-dev174-process-audit.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x))
