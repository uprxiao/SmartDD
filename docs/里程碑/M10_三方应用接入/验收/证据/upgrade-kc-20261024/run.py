import subprocess,os,json,datetime
from pathlib import Path
root=Path('/private/tmp/willyou-m10-kc-faults-20261024')
env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR'] if k in os.environ}
env.update(WILLYOU_OLD_APP='/private/tmp/willyou-m10-cq-package-20261023/mac-arm64/WillYou.app/Contents/MacOS/WillYou',WILLYOU_ACCEPTANCE_APP='/private/tmp/willyou-m10-jv-package-20261024/mac-arm64/WillYou.app/Contents/MacOS/WillYou')
rows=[]
for phase in ['publication-before','publication-after','transaction','committed','second-application-failure']:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (root/(phase+'.log')).open('w') as f:
  r=subprocess.run(['node','scripts/applications/upgrade-transaction-crash-app.mjs'],env={**env,'WILLYOU_CRASH_PHASE':phase},stdout=f,stderr=subprocess.STDOUT)
 row={'phase':phase,'startedAt':start,'exitCode':r.returncode};rows.append(row);(root/'progress.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(row),flush=True)
 if r.returncode: break
(root/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')
raise SystemExit(0 if len(rows)==5 and all(r['exitCode']==0 for r in rows) else 1)
