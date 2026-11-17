#!/usr/bin/env python3
from pathlib import Path
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile

here=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('runner',here.parent/'复跑.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
scratch=Path(sys.argv[1]).resolve();t3=Path(sys.argv[2]).resolve()
root=Path(tempfile.mkdtemp(prefix='m14-replay-guards-'));rows=[]
name='20261114_程序化启动与私有业务桥验证'
params=(scratch/'restored',scratch/'owner',scratch/'deps-orig',scratch/'owner/node_modules',t3)
def check(label,fn):
    try:fn();rows.append({'id':label,'status':'passed'})
    except Exception as e:rows.append({'id':label,'status':'failed','error':str(e)})
def rejected(out):
    try:r.prepare(name,out,*params)
    except ValueError:return
    raise AssertionError('output guard accepted forbidden root')
try:
    check('checkout output rejected',lambda:rejected(r.REPO/'outputs/replay-forbidden'))
    check('old source root rejected',lambda:rejected(scratch/'restored/tmp/willyou-m14-launch-bridge-probe'))
    def fresh():
        work,_=r.prepare(name,root/'fresh',*params)
        assert work.exists()
        receipt=json.loads((root/'fresh/preparation.json').read_text())
        assert receipt['immutableBytesUnchanged']
        scripts=[p for p in work.rglob('build*.mjs') if 'attempt-' not in str(p)]
        assert scripts
        for p in scripts:
            s=p.read_text()
            if '__m14Build' in s:assert '"node-pty"' in s
        assert str(scratch/'owner') in (work/'build.mjs').read_text()
    check('fresh root accepted, explicit owner and all build aliases retained',fresh)
    def escape():
        victim=root/'victim.mjs';victim.write_text("throw Error('must never execute')")
        cmd=[sys.executable,str(here.parent/'复跑.py'),name,'--out',str(root/'escape'),
             '--environment',str(params[0]),'--owner',str(params[1]),'--sdk',str(params[2]),
             '--node-modules',str(params[3]),'--t3',str(params[4]),'--run','../victim.mjs']
        result=subprocess.run(cmd,capture_output=True,text=True)
        assert result.returncode!=0
        assert 'Entry must be a file inside the prepared copy' in result.stderr
        assert 'must never execute' not in result.stderr
    check('entry traversal rejected before execution',escape)
    def launch_guard(name,entry,required_error):
        cmd=[sys.executable,str(here.parent/'复跑.py'),name,'--out',str(root/('launch-'+entry.replace('/','-'))),
             '--environment',str(params[0]),'--owner',str(params[1]),'--sdk',str(params[2]),
             '--node-modules',str(params[3]),'--t3',str(params[4]),'--run',entry]
        result=subprocess.run(cmd,capture_output=True,text=True)
        assert result.returncode!=0
        assert required_error in result.stderr,result.stderr
    check('browser main requires Electron, never falls back to Node',lambda:launch_guard('20261114_浏览器关闭与崩溃边界验证','main.mjs','Missing explicit Electron path'))
    check('plugin exceptions require explicit mode',lambda:launch_guard('20261114_插件拒绝卸载与不兼容更新验证','probe.mjs','plugin-exceptions requires --mode'))
finally:shutil.rmtree(root)
out={'scope':'actual portable helper guards and actual prepared source, no model calls',
     'tests':rows,'failed':sum(x['status']=='failed' for x in rows),'cleanup':not root.exists()}
(here/'results/portability-guards.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(out,ensure_ascii=False,indent=2));raise SystemExit(bool(out['failed']))
