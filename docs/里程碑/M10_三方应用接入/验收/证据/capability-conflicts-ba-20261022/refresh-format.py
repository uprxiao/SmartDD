from pathlib import Path
import json,hashlib,subprocess,datetime
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');e=Path('/private/tmp/m10-capability-conflicts-ba-20261022');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');v=e/'final-work';m=r/'docs/里程碑/M10_三方应用接入';parent='9d38ee044ac425961a7fa54bdb123429f07626cf';read=lambda n:json.loads((e/n).read_text());sha=lambda b:hashlib.sha256(b).hexdigest();at=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();write=lambda p,x:p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def git(*args):return subprocess.check_output(['git',*args],cwd=r)
assert git('rev-parse','HEAD').decode().strip()==parent
proof=read('post-test-format-proof.json');rel=proof['path'];oldPaths=read('stage-files.json');assert{x.decode() for x in git('diff','--cached','--name-only','-z').split(b'\0') if x}==set(oldPaths)
staged=[]
for p in oldPaths:
 blob=git('show',':'+p);raw=(r/p).read_bytes();assert blob==raw or p==rel and sha(blob)==proof['priorSha256'] and sha(raw)==proof['finalSha256'],p;staged.append({'path':p,'sha256':sha(blob)})
write(e/'staged-before-format.json',{'files':staged,'scope':'only our original83 staged paths;no other staged work'});write(e/'stage-files-before-format.json',oldPaths)
source=read('final-source.json');write(e/'pre-format-final-source.json',source);before=read('final-build-input-snapshot.json');new=[];changed=[]
for f in before['files']:
 raw=(w/f['path']).read_bytes();assert raw==(v/f['path']).read_bytes();h=sha(raw);assert h==f['sha256'] or f['path']==rel and f['sha256']==proof['priorSha256'] and h==proof['finalSha256'];new.append({'path':f['path'],'bytes':len(raw),'sha256':h})
 if h!=f['sha256']:changed.append(f['path'])
assert changed==[rel] and len(new)==2010
write(e/'final-build-input-snapshot.json',{'at':at(),'files':new,'postTestFormatProof':'post-test-format-proof.json'})
parents=e/'format-parent';parents.mkdir();recovered=e/'formatted-recovered-source';recovered.mkdir();diff=[]
for f in source['files']:
 p=f['path'];raw=(w/p).read_bytes();assert(r/p).read_bytes()==raw;f.update({'bytes':len(raw),'sha256':sha(raw)});(e/'final-source'/p).write_bytes(raw)
 left='/dev/null'
 if f['priorSha256']:
  body=git('show',parent+':'+p);assert sha(body)==f['priorSha256'];q=parents/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(body);z=recovered/p;z.parent.mkdir(parents=True,exist_ok=True);z.write_bytes(body);left=str(q)
 d=subprocess.run(['git','diff','--no-index','--',left,str(w/p)],capture_output=True,text=True);assert d.returncode==1;diff.append(d.stdout.replace('a'+str(parents/p),'a/'+p).replace('b'+str(w/p),'b/'+p).replace('a/dev/null','a/'+p))
source['postTestFormatProof']='post-test-format-proof.json';write(e/'final-source.json',source);(e/'final-source.diff').write_text(''.join(diff));subprocess.run(['git','apply',str(e/'final-source.diff')],cwd=recovered,capture_output=True,check=True)
for f in source['files']:assert sha((recovered/f['path']).read_bytes())==f['sha256']
write(e/'source-recovery.json',{'at':at(),'parent':parent,'parentPlusPatchActualRecovery':True,'files':10,'allHashesMatch':True,'postTestFormatProof':'post-test-format-proof.json'})
proof.update({'finalTypecheck':'format-typecheck-final.txt','finalTypecheckExit':0,'allOther2009FinalInputsUnchanged':True});write(e/'post-test-format-proof.json',proof)
verification=read('verification.json');verification.update({'typecheckRaw':'format-typecheck-final.txt','typecheckSource':'private mirror exact final2010 inputs after EOF normalization','softwareAsTestedInputs':'candidate3-inputs.json','postTestFormatProof':'post-test-format-proof.json','compiledCodeUnchangedForAll1353SoftwareResults':True});write(e/'verification.json',verification)
layer=read('layer-reuse.json');layer.update({'scopeOfPreviousByteIdentityProof':'as-tested candidate3 before harmless EOF normalization','postTestFormatProof':'post-test-format-proof.json','finalOther2009InputsUnchanged':True,'exactExecutableOutputsSameTypeScriptAndEsbuild':True});write(e/'layer-reuse.json',layer)
fmt='\n## 提交前格式检查\n\n提交检查发现native-application-conflicts.ts文件末尾多一空行，已仅删除该空行。TypeScript与esbuild 0.25.12生成的可执行代码分别逐字节相同，其他2009输入不变；最终2010文本输入补跑类型检查通过。1353项软件结果依据编译输出一致复用，不重复运行低影响格式修改；保留首次格式失败、旧patch／原始测试输入及本次新源码恢复证明。见原始证据post-test-format-proof.json与format-typecheck-final.txt。\n'
q=e/'checkpoint-final.md';text=q.read_text();assert(m/'技研/公共原生能力冲突的独立加载_20261022.md').read_text()==text;q.write_text(text+fmt);(m/'技研/公共原生能力冲突的独立加载_20261022.md').write_text(text+fmt)
notes=['docs/里程碑/M10_三方应用接入/README.md','docs/里程碑/M10_三方应用接入/交付说明.md','docs/里程碑/M10_三方应用接入/验收/执行与缺陷记录.md','docs/里程碑/M10_三方应用接入/验收/测试用例.md','docs/里程碑/README.md','docs/需求池.md','docs/里程碑/M10_三方应用接入/技研/开发缺口与实施顺序_20261021.md']
for p in notes:
 q=r/p;text=q.read_text();needle='65相关文件335输入相同。';assert text.count(needle)==1;q.write_text(text.replace(needle,'测试时65相关文件335输入相同；提交前去末尾空行，编译输出一致并补过类型。'))
q=e/'driver-events.json';events=read('driver-events.json');events['events'] += [{'kind':'precommit-format','result':'one extra blank EOF line blocked commit;no commit created;staged scope preserved;only EOF normalized;TS/esbuild executable bytes identical,final types0'},{'kind':'format-check-dependency','result':'first proof helper could not resolve non-direct esbuild dependency before any source mutation;used existing pinned0.25.12 transitive package;earlier preformat types not used as final'}];write(q,events)
folder='capability-conflicts-ba-20261022';outerpath=m/'验收/证据/m10-capability-conflicts-ba-20261022.json';outer=json.loads(outerpath.read_text());outer.update({'recordedAt':at(),'source':source,'verification':verification,'postTestFormatProof':'post-test-format-proof.json'})
exclude={'archive.py','commit.py','current-state.json','stage-files.json','staged-check.txt','commit-result.json','commit-message.txt','commit-output.txt','precommit-review.json'};raws=sorted(p.name for p in e.iterdir() if p.is_file() and p.suffix in ['.json','.txt','.diff','.md','.py','.cjs'] and p.name not in exclude);artifacts=[]
for n in raws:
 raw=(e/n).read_bytes();(m/'验收/证据'/folder/n).write_bytes(raw);artifacts.append({'path':'证据/'+folder+'/'+n,'bytes':len(raw),'sha256':sha(raw)})
outer['artifacts']=artifacts;write(outerpath,outer);stem='docs/里程碑/M10_三方应用接入/验收/证据/'+folder+'/'
fixed=[p for p in oldPaths if not p.startswith(stem)];paths=fixed+[stem+'.gitattributes']+[stem+n for n in raws];assert len(paths)==len(set(paths));write(e/'stage-files.json',paths);(e/'stage-files.nul').write_bytes(b''.join(p.encode()+b'\0' for p in paths))
for f in read('preexisting-worktree.json')+read('preexisting-untracked.json'):assert sha((r/f['path']).read_bytes())==f['sha256']
state=read('current-state.json');state.update({'canonicalCopied':True,'postTestFormatProof':proof,'verification':verification,'stagedBeforeFormat':83,'newStageFiles':len(paths),'liveSessions':{},'commitPending':True});write(e/'current-state.json',state);write(Path('/private/tmp/m10-current-handoff-20261022.json'),state);print(json.dumps({'stageFiles':len(paths),'rawArtifacts':len(raws),'onlyFormatChange':rel,'typecheckFinalExit':0,'softwareCompiledOutputUnchanged':1353,'preservedDocs':4,'preservedUntracked':9}))
