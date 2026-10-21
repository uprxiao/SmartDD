from pathlib import Path
import json,hashlib,subprocess,difflib,datetime
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-claude-delivery-aw-20261022');base='cd3dc3defab38bcb7ec0a6703d84e39e48f02f80';sha=lambda b:hashlib.sha256(b).hexdigest();at=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r).decode().strip()==base
broad=json.loads((e/'regression-result.json').read_text());assert broad['exitCode']==0 and broad['files']==64 and not broad['failed'] and not broad['pending'] and broad['sourceFrozen']
initial=json.loads((e/'source-before-proof.json').read_text());manifest=json.loads((e/'build-input-before-proof.json').read_text());changed=['src/main/core/applications/agent-adapter-registry.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts']
for f in manifest['files']:
 if f['path'] not in changed:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
red=json.loads((e/'proof-red-report.json').read_text());assert red['numFailedTests']==1 and red['numPassedTests']==0
final=json.loads((e/'proof-regression-report.json').read_text());assert not final['numFailedTests'] and not final['numPendingTests'] and len(final['testResults'])==2
assert {Path(t['name']).relative_to(w).as_posix() for t in final['testResults']}=={'src/main/core/applications/__tests__/agent-adapters.test.ts',changed[1]}
types=json.loads((e/'types-result.json').read_text());assert types['exitCode']==0 and types['sourceInputs']==2005 and types['finalSourceFrozen']
records=[];diff=[]
for f in initial['files']:
 p=f['path'];raw=(w/p).read_bytes();oldrun=subprocess.run(['git','show',base+':'+p],cwd=r,stdout=subprocess.PIPE,stderr=subprocess.PIPE);old=oldrun.stdout if oldrun.returncode==0 else None;assert (sha(old) if old else None)==f['priorSha256'];records.append({'path':p,'bytes':len(raw),'sha256':sha(raw),'priorSha256':f['priorSha256']});diff.extend(difflib.unified_diff(old.decode().splitlines(True) if old else [],raw.decode().splitlines(True),fromfile='a/'+p if old else '/dev/null',tofile='b/'+p));target=e/'source'/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
(e/'source.json').write_text(json.dumps({'baseCommit':base,'files':records},indent=2)+'\n');(e/'source.diff').write_text(''.join(diff));mapped={f['path']:f for f in manifest['files']}
for f in records:mapped[f['path']]={k:v for k,v in f.items() if k in ['path','bytes','sha256']}
manifest.update(recordedAt=at(),sourceBaseline='final AW after host proof completeness fix;original64 run preserved independently',files=[mapped[p] for p in sorted(mapped)]);assert len(mapped)==2005;(e/'build-input-snapshot.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
def cases(report):
 result={};occurrences={}
 for t in report['testResults']:
  f=Path(t['name']).relative_to(w).as_posix()
  for a in t['assertionResults']:
   named=(f,a['fullName']);occurrences[named]=occurrences.get(named,0)+1
   k=(*named,occurrences[named]);assert k not in result
   result[k]={'file':f,'name':a['fullName'],'parameterOccurrence':occurrences[named],'status':a['status']}
 return result
original=cases(json.loads((e/'regression-report.json').read_text()));latest=original.copy();follow=cases(final);followFiles={k[0] for k in follow}
# Both affected files are rerun in full.No filtered old case may silently disappear.
assert all(k in follow for k in original if k[0] in followFiles)
latest.update(follow);stats={'files':len({k[0] for k in latest}),'total':len(latest),'passed':sum(a['status']=='passed' for a in latest.values()),'failed':sum(a['status']=='failed' for a in latest.values()),'pending':sum(a['status'] not in ['passed','failed'] for a in latest.values())};assert stats['files']==64 and stats['failed']==0 and stats['pending']==0 and stats['total']==len(original)+1
primary=[a for (f,n,occurrence),a in latest.items() if 'keeps healthy Mail draft calls available in a new ' in n];assert len(primary)==2 and all(a['status']=='passed' for a in primary)
(e/'latest-case-status.json').write_text(json.dumps(list(latest.values()),ensure_ascii=False,indent=2)+'\n')
for f in json.loads((e/'environment.json').read_text())['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256'],f['path']
v={'at':at(),'sourceFrozen':True,'sourceInputs':2005,'sourceFiles':17,'productionFiles':11,'testAndFixtureFiles':6,'typecheckExit':0,'latestDistinct':stats,'singleInvocation':False,'caseIdentity':'file/fullName/parameter occurrence in definition order;retain7 independently parameterized same-name native-mail-context cases;do not add reruns','originalFullRun':{k:broad[k] for k in ['files','passed','failed','pending','sourceInputs']},'afterFullRun':{'reason':'host Claude delivery proof must include actual canonical root and hash;negative red retained','affectedFullFiles':2,'passed':final['numPassedTests'],'failed':0,'pending':0,'unchangedOtherFiles':62},'impactReview':'post-full production delta is one preflight guard only when claudeDelivery proof is supplied;main TaskService full file and adapter full file rerun;other62 files and all other source hashes unchanged;direct Codex/legacy/static fixtures do not supply this proof','newCases':24,'originalMainBothAgentsPassed':True,'actualAgentSessionRun':False,'actualAppRun':False,'newProductionDependencyOrNativeBuild':False,'testOnlyNativeCompilation':'Foxmail reader fixture into private temporary directory','remaining':'REVIEW-01 app-specific conflicts,all-app unavailable retaining independent capabilities;87-row audit;new package/all72','goal':'active full M10;phase5;not complete'}
(e/'next.md').write_text(f"""# AW验证后接续

AW开发快照：原64文件1254项全过，随后补宿主缺plugin root负向红测（1失败、95按名称未执行）及实际修复；两个受影响完整文件复验{final['numPassedTests']}通过。最新64文件去重{stats['total']}项全过、最终2005输入类型0。不同基线和原失败分别保留，不是一次全量1255项调用。当前仍第5步、目标active；没有实际Agent／新App／GUI／外部业务／发送或发布。

提交仍在独立feature/0.0.2：本包sourceBase为AV cd3dc3d加17文件可恢复差异；最终HEAD见提交后本机current-state.json或Git，机器证据不制造自引用commit hash。M9和旧AF未知桥均未操作。无运行中的软件job需要接管。

下一项REVIEW-01：应用特定名称／配置冲突隔离，以及所有应用都故障时保留独立健康标准Skills／项目MCP。按R07先加真实TaskService红测，保留原S／native ID／名称／实际路径／ref及当前权限；空范围须显式持久凭据，不将旧缺失scope解释为全权。[只读核对与实现候选](next-empty-scope-notes.md)。

继续87编号核对，R08-01唯一实名／更早上下文要用真实认证用户输入和明确草稿修订，不接受模型approved；R09 T39／T40完整权限／日志及多项目扩展实验仍欠，不能因registry7项通过关闭。还要核查完成delivery操作的previous／abandoned stage如何在无引用且可证明无读取者时回收，不凭年龄或PID缺席删除。

满足第5步门槛后新包，两实际Agent／全部72正式App和系统前置／必要回归，再缺陷复验和交付。当前正式仍历史T42／T63 2/72、T64部分；本次新源码未打包，旧包不抵扣最终全验。
""")
(e/'verification.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');print(json.dumps(v,ensure_ascii=False))
