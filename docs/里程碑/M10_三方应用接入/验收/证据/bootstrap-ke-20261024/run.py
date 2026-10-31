import subprocess,os,json,datetime
from pathlib import Path
root=Path('/private/tmp/willyou-m10-ke-bootstrap-20261024')
env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR'] if k in os.environ}
env['WILLYOU_ACCEPTANCE_APP']='/private/tmp/willyou-m10-jv-package-20261024/mac-arm64/WillYou.app/Contents/MacOS/WillYou'
rows=[]
for fixture,phase in [('empty','prepared'),('empty','backed-up'),('empty','schema-transaction'),('legacy-m0','schema-transaction'),('legacy-prefix','prepared'),('legacy-prefix','backed-up'),('legacy-prefix','schema-transaction'),('legacy-prefix','mirror-publication')]:
 label=fixture+'-'+phase
 with (root/(label+'.log')).open('w') as f:
  r=subprocess.run(['node','scripts/applications/bootstrap-crash-app.mjs'],env={**env,'WILLYOU_CRASH_PHASE':phase,'WILLYOU_BOOTSTRAP_FIXTURE':fixture},stdout=f,stderr=subprocess.STDOUT)
 row={'fixture':fixture,'phase':phase,'exitCode':r.returncode};rows.append(row);(root/'progress.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(row),flush=True)
 if r.returncode: break
(root/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')
raise SystemExit(0 if len(rows)==8 and all(x['exitCode']==0 for x in rows) else 1)
