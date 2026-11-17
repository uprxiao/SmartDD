#!/usr/bin/env python3
"""Prepare every retained experiment off-repository; execute no old model probes."""
from pathlib import Path
import importlib.util
import json
import shutil
import sys
import tempfile
import re

here=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('m14_replay',here.parent/'复跑.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
scratch=Path(sys.argv[1]).resolve()
t3=Path(sys.argv[2]).resolve()
catalog=json.loads((here.parent/'实验目录.json').read_text())
root=Path(tempfile.mkdtemp(prefix='m14-portability-'))
rows=[]
try:
    for entry in catalog['experiments']:
        if entry.get('newExperiment'):
            continue
        name=entry['name'];out=root/name
        try:
            work,_=runner.prepare(name,out,scratch/'restored',scratch/'owner',scratch/'deps-orig',scratch/'owner/node_modules',t3)
            target=work/entry['entry']
            if not target.exists():raise ValueError('Declared entry missing: '+str(target))
            receipt=json.loads((out/'preparation.json').read_text())
            if not receipt['immutableBytesUnchanged']:raise ValueError('Content-addressed input changed')
            builders=[]
            for p in work.rglob('*.mjs'):
                if runner.immutable(p):continue
                text=p.read_text(errors='surrogateescape')
                if 'const build=(o)=>__m14Build' in text:
                    if '"node-pty"' not in text:raise ValueError('Missing node-pty alias')
                    builders.append(str(p.relative_to(work)))
                for imp in re.findall(r'''import[^;\n]+from\s*['"][^'"]*esbuild[^'"]*['"];''',text):
                    named=re.search(r'\{([^}]+)\}',imp)
                    uses_build=(bool(re.search(r'\bbuild\b',named[1])) if named else True)
                    if uses_build and '__m14' not in imp:
                        raise ValueError('Unwrapped esbuild import: '+str(p.relative_to(work)))
            rows.append({'experiment':name,'status':'passed','entry':entry['entry'],'runner':entry['runner'],
                         'immutableFiles':len(receipt['immutableSha256']),'adaptedBuilders':builders})
        except Exception as e:
            rows.append({'experiment':name,'status':'failed','error':str(e)})
        finally:
            if out.exists():shutil.rmtree(out)
        print(name,rows[-1]['status'],flush=True)
finally:
    shutil.rmtree(root)
result={'scope':'all retained historical inputs prepared outside repository; entry existence, asset hashes and build wrappers checked; not all experiments executed',
        'results':rows,'failed':sum(x['status']=='failed' for x in rows),'cleanup':not root.exists()}
(here/'results/portability.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
raise SystemExit(1 if result['failed'] else 0)
