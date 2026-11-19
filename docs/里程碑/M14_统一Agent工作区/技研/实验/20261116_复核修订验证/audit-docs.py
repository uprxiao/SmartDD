#!/usr/bin/env python3
"""Check current baselines, preserved originals, scope and local Markdown links."""
from pathlib import Path
import gzip
import hashlib
import json
import re
import subprocess
import unicodedata
from urllib.parse import unquote

here=Path(__file__).resolve().parent
b=here.parents[2];repo=next(p for p in here.parents if (p/'src/main/db/schema.ts').exists())
sha=lambda x:hashlib.sha256(x).hexdigest()
checks=[]
def check(label,ok,detail=None):checks.append({'id':label,'passed':bool(ok),'detail':detail})
snapshots=json.loads((here/'snapshots.json').read_text())
originals=json.loads(gzip.decompress((here/'link-originals.json.gz').read_bytes()))
for row in snapshots:
    path=b/row['snapshot'];raw=originals.get(str(path.relative_to(repo)),path.read_text()).encode()
    check('preserved snapshot '+row['snapshot'],sha(raw)==row['sha256'])
for row in json.loads((b/'技研/历史/实验迁移清单.json').read_text()):
    failed=[]
    for f in row['files']:
        path=repo/row['to']/f['path']
        raw=originals.get(str(path.relative_to(repo)))
        raw=raw.encode() if raw is not None else path.read_bytes()
        if sha(raw)!=f['sha256']:failed.append(f['path'])
    check('archived experiment '+Path(row['to']).name,not failed,failed)
baseline=json.loads((here/'source-baseline.json').read_text())
# 2026-11-17 起 M14 已获准正式开发，生产代码按计划变化；这里只核对研究基线提交中的文件仍与记录一致。
import subprocess
def at_commit(path):
    return subprocess.run(['git','-C',str(repo),'show',f"{baseline['smartddCommit']}:{path}"],capture_output=True,check=True).stdout
check('research baseline inputs recorded',all(sha(at_commit(x['path']))==x['sha256'] for x in baseline['smartdd']))
size=(b/'技研/技术方案.md').stat().st_size
old=next(x['bytes'] for x in snapshots if x['source']=='技研/技术方案.md')
check('implementation design within one fifth',size<=old/5,{'beforeBytes':old,'afterBytes':size,'ratio':size/old})
requirements=(b/'需求.md').read_text()
check('R01-R13 each have one current definition',all(len(re.findall(r'^### M14-R'+f'{i:02d}'+r'\b',requirements,re.M))==1 for i in range(1,14)))
casefile=(b/'验收/测试用例.md').read_text();ledger=(b/'验收/执行与缺陷记录.md').read_text()
cases=re.findall(r'^### (M14-A\d+)',casefile,re.M);executed=re.findall(r'^### (M14-A\d+)',ledger,re.M)
check('case IDs unique and match execution ledger',len(cases)==len(set(cases)) and set(cases)==set(executed),{'cases':len(cases)})
execution_rows=re.findall(r'^### (M14-A\d+)\n\n(.*?)(?=^#{2,3} |\Z)',ledger,re.M|re.S)
states=[re.search(r'^- 状态：(通过|失败|未执行|阻塞|范围外)(?=[。（])',row,re.M) for _,row in execution_rows]
summary=re.search(r'当前适用用例 (\d+) 条；通过 (\d+)、失败 (\d+)、未执行 (\d+)、阻塞 (\d+)；范围外 (\d+) 条',ledger)
counts=[sum(state is not None and state[1]==name for state in states) for name in ('通过','失败','未执行','阻塞','范围外')]
pass_evidence=all(re.search(r'^- 证据／缺陷：.*\]\(证据/并行测试/[^)]+\)',row,re.M)
                  for (_,row),state in zip(execution_rows,states) if state is not None and state[1]=='通过')
check('execution totals match and product passes link to packaged evidence',len(states)==len(cases) and all(states)
      and summary is not None and list(map(int,summary.groups()))==[sum(counts[:4]),*counts] and pass_evidence)
report=(b/'技研/复核_20261116/复核报告.md').read_text()
section=report.split('## 7. 用户已确认的决定（2026-11-16）\n',1)[1].split('\n## 8.',1)[0]
decisions={
 'D1':'入口隐藏、数据保留；“终端即任务”代码与 `legacy-*` 兼容层在 M14 开发完成并测试通过后清理（C14）；手动终端保留（RC7）',
 'D2':'按 T3 规则，不做',
 'D3':'按 T3：订阅／原生登录沿用，每轮显式下发权限；托管供应商隔离（C08）',
 'D4':'首期做 B（共用目录、写入排队、只读并行）；C（Git worktree 并行写）等 B 稳定后再加（RC8、C15）',
 'D5':'首期做每轮改动文件与差异查看；回退不做，交给用户用 git／svn 命令（RC9、C16）',
}
for decision,expected in decisions.items():
    row=next(line for line in section.splitlines() if line.startswith('| '+decision+' |'))
    check('confirmed decision unchanged '+decision,row.split('|')[3].strip()==expected)
decisions={
'D1':'入口隐藏、数据保留；“终端即任务”代码与 `legacy-*` 兼容层在 M14 开发完成并测试通过后清理（C14）；手动终端保留（RC7）',
'D2':'按 T3 规则，不做',
'D3':'按 T3：订阅／原生登录沿用，每轮显式下发权限；托管供应商隔离（C08）',
'D4':'首期做 B（共用目录、写入排队、只读并行）；C（Git worktree 并行写）等 B 稳定后再加（RC8、C15）',
'D5':'首期做每轮改动文件与差异查看；回退不做，交给用户用 git／svn 命令（RC9、C16）'}
check('confirmed D1-D5 verbatim preserved',all(any(line.startswith('| '+key+' |') and value in line for line in section.splitlines()) for key,value in decisions.items()),{'sectionSha256':sha(section.encode())})

def slugs(text):
    result=set(re.findall(r'<a\s+[^>]*(?:id|name)=["\']([^"\']+)',text));counts={}
    for line in text.splitlines():
        if not re.match(r'^#{1,6} ',line):continue
        value=re.sub(r'^#+\s*','',line).strip().lower()
        value=re.sub(r'[`*]','',value)
        value=''.join(c for c in value if not unicodedata.category(c).startswith(('P','S')) or c in '-_')
        value=re.sub(r'\s','-',value)
        n=counts.get(value,0);counts[value]=n+1;result.add(value+('-'+str(n) if n else ''))
    return result
links=[];bad=[];heading_cache={}
for p in b.rglob('*.md'):
    # Markdown inside code fences is sample content, not document navigation.
    text=re.sub(r'^```[^\n]*\n[\s\S]*?^```\s*$', '',p.read_text(),flags=re.M)
    for m in re.finditer(r'(?<!!)\[[^\]]*\]\((<[^>]+>|[^\s)]+)\)',text):
        href=m[1].strip('<>')
        if re.match(r'^[a-zA-Z][\w+.-]*:',href) or href.startswith('/'):continue
        name,sep,anchor=href.partition('#');target=(p.parent/unquote(name)).resolve() if name else p
        try:exists=target.exists()
        except OSError:exists=False
        issue=None
        if not exists:issue='missing-path'
        elif sep and anchor and target.suffix=='.md' and not re.match(r'^L\d+',anchor):
            if target not in heading_cache:heading_cache[target]=slugs(target.read_text())
            if unquote(anchor) not in heading_cache[target]:issue='missing-anchor'
        row={'document':str(p.relative_to(repo)),'href':href,'issue':issue}
        links.append(row)
        if issue:bad.append(row)
check('M14 local links and anchors',not bad,{'checked':len(links),'bad':len(bad)})
result={'checks':checks,'failed':sum(not x['passed'] for x in checks),'localLinkFailures':bad}
(here/'results/document-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checks':len(checks),'failed':result['failed'],'failedChecks':[x for x in checks if not x['passed']],'badLinks':bad[:35]},ensure_ascii=False,indent=2))
raise SystemExit(bool(result['failed']))
