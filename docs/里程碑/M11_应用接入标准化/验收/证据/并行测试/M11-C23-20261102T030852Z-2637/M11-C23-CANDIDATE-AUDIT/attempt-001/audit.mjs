// Read-only audit of a fixed Git object, not a build/test runner.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, posix} from 'node:path';
const repository='/Users/liubu/Documents/ChatGPT/SmartDD-m10';
const output='/private/tmp/willyou-m11-c23-2637/candidate-audit/attempt-001';
const candidate='5471b7ec73fbe82340dd9051bffec66e8ca3e9d0';
const base='73946425efe7735bf7e7bedd62142f9a885179c4';
const prefix='docs/里程碑/M11_应用接入标准化/验收/证据/并行测试/M11-C23-20261102T030852Z-2637';
const sha=b=>createHash('sha256').update(b).digest('hex');
const commands=[];
function git(args,input){commands.push({program:'git',argv:args,inputSpecs:input?input.toString().split('\n').filter(Boolean).length:0});return execFileSync('/usr/bin/git',args,{cwd:repository,input,maxBuffer:128*1024*1024});}
const cache=new Map();
function batch(ref,paths){
 const absent=paths.filter(path=>!cache.has(ref+':'+path));if(!absent.length)return;
 const bytes=git(['cat-file','--batch'],Buffer.from(absent.map(p=>ref+':'+p).join('\n')+'\n'));let offset=0;
 for(const path of absent){const end=bytes.indexOf(10,offset),header=bytes.subarray(offset,end).toString();offset=end+1;if(header.endsWith(' missing')){cache.set(ref+':'+path,null);continue;}const match=/^[a-f0-9]+ blob ([0-9]+)$/.exec(header);if(!match)throw Error('Unexpected Git object header');const n=Number(match[1]);cache.set(ref+':'+path,bytes.subarray(offset,offset+n));offset+=n+1;}
 if(offset!==bytes.length)throw Error('Batch framing mismatch');
}
function blob(ref,path){batch(ref,[path]);return cache.get(ref+':'+path);}
function json(path){return JSON.parse(blob(candidate,path));}
const archivePaths=git(['ls-tree','-r','-z','--name-only',candidate,'--',prefix]).toString().split('\0').filter(Boolean);
batch(candidate,archivePaths);
const manifestChecks=[],manifestProblems=[];
for(const path of archivePaths.filter(p=>p.endsWith('/manifest.json'))){
 const manifest=json(path),checked=[];
 if(!Array.isArray(manifest.files)){manifestProblems.push({path,code:'UNSUPPORTED_MANIFEST_FILE_LIST'});continue;}
 for(const file of manifest.files){
  const relative=file.path??file.name,expected=file.sha256??file.hash;
  if(typeof relative!=='string'||posix.isAbsolute(relative)||relative.split('/').includes('..')){manifestProblems.push({path,code:'UNSAFE_MANIFEST_PATH'});continue;}
  const target=posix.join(dirname(path),relative),bytes=blob(candidate,target);
  if(!bytes){manifestProblems.push({path,target,code:'MISSING_ARCHIVED_FILE'});continue;}
  const actual=sha(bytes),size=file.size??file.bytes;
  if(actual!==expected||size!==undefined&&bytes.length!==size)manifestProblems.push({path,target,code:'HASH_OR_SIZE_MISMATCH',expected,actual});
  checked.push({path:relative,sha256:actual,bytes:bytes.length});
 }
 manifestChecks.push({path,manifestSha256:sha(blob(candidate,path)),checkedFiles:checked.length});
}
const privacy={files:archivePaths.length,bytes:0,findings:[],syntheticAddressOccurrences:0,binaryDatabaseFiles:0};
const email=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,63}/gi;
const allowedDomain=/^(?:[A-Za-z0-9-]+\.)*(?:example\.(?:com|org|net|test|invalid)|willyou\.(?:local|test)|smartdd\.(?:local|test)|localhost)$/i;
for(const path of archivePaths){
 const bytes=blob(candidate,path);privacy.bytes+=bytes.length;
 if(bytes.subarray(0,16).toString()==='SQLite format 3\0'||/\.(?:db|sqlite|eml|mail|attachment|wal|shm)$/.test(path)){privacy.binaryDatabaseFiles++;privacy.findings.push({path,code:'RAW_DATA_FILE'});}
 const text=bytes.toString('utf8');
 for(const match of text.matchAll(email)){const domain=match[0].split('@').at(-1);if(allowedDomain.test(domain))privacy.syntheticAddressOccurrences++;else privacy.findings.push({path,line:text.slice(0,match.index).split('\n').length,code:'NON_SYNTHETIC_EMAIL_LITERAL',valueSha256:sha(match[0])});}
 for(const [code,pattern]of[['PLAINTEXT_REAL_PROFILE',/\/Users\/[^\s"'\\]+[^\n"']*Foxmail[^\n"']*\/Profiles\/[^\s"']+/g],['CREDENTIAL_SHAPED_LITERAL',/(?<![A-Za-z0-9_-])(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g]])for(const match of text.matchAll(pattern))privacy.findings.push({path,line:text.slice(0,match.index).split('\n').length,code,valueSha256:sha(match[0])});
}
const authorityPath='docs/里程碑/M11_应用接入标准化/验收/测试用例.md';
const authority=blob(candidate,authorityPath).toString(),rows=authority.split('\n').filter(x=>/^\| M11-T\d+／/.test(x));
const unique=new Map();for(const row of rows){const id=/^\| M11-(T\d+)/.exec(row)[1];if(unique.has(id))throw Error('Duplicated authority case');unique.set(id,row);}
const passed=[...unique].filter(([,row])=>/\| (?:\*\*)?通过|\| \d{4}-\d{2}-\d{2} I通过/.test(row)).map(([id])=>id);
const deferred=[...unique].filter(([,row])=>/\| \*\*暂缓/.test(row)).map(([id])=>id);
const counts={unique:unique.size,passed:passed.length,deferred:deferred.length,deferredIds:deferred,passRate:Number((passed.length/unique.size*100).toFixed(2)),t17MentionsEightSix:/8 项/.test(unique.get('T17'))&&/6 项/.test(unique.get('T17'))};
const frozenPath=prefix+'/M11-C23-PACKAGE/attempt-001/source-manifest.json',frozen=json(frozenPath);
const recovery=JSON.parse(await readFile('/private/tmp/willyou-m11-c23-2637/source-recovery/result.json','utf8'));
const patch=await readFile('/private/tmp/willyou-m11-c23-2637/source-recovery/frozen-source.patch');
batch(base,frozen.files.map(x=>x.path));
const recoveryProblems=[],patchOutputs=new Map();
const patchLines=patch.toString().split(/(?<=\n)/);let i=0;
while(i<patchLines.length){if(!patchLines[i].startsWith('--- a/')){i++;continue;}const path=patchLines[i++].slice(6).trim();if(patchLines[i++]!=='+++ b/'+path+'\n')throw Error('Patch file header mismatch');const original=blob(base,path).toString().split(/(?<=\n)/);let cursor=0,out=[];
 while(i<patchLines.length&&!patchLines[i].startsWith('--- a/')){const hunk=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(patchLines[i]);if(!hunk){i++;continue;}const start=Number(hunk[1])-1;out.push(...original.slice(cursor,start));cursor=start;i++;while(i<patchLines.length&&!patchLines[i].startsWith('@@ ')&&!patchLines[i].startsWith('--- a/')){const row=patchLines[i++],marker=row[0],body=row.slice(1);if(marker===' '||marker==='-'){if(original[cursor]!==body)throw Error('Patch context mismatch');cursor++;}if(marker===' '||marker==='+')out.push(body);}}
 out.push(...original.slice(cursor));patchOutputs.set(path,Buffer.from(out.join('')));
}
let unchanged=0;
for(const file of frozen.files){const bytes=patchOutputs.get(file.path)??blob(base,file.path);if(!bytes||sha(bytes)!==file.sha256)recoveryProblems.push({path:file.path,code:'RECOVERY_HASH_MISMATCH'});else if(!patchOutputs.has(file.path))unchanged++;}
const sourceRecovery={baseCommit:base,manifestSha256:sha(blob(candidate,frozenPath)),frozenCount:frozen.files.length,gitUnchanged:unchanged,patched:[...patchOutputs.keys()],patchSha256:sha(patch),receiptMatches:recovery.patchSha256===sha(patch)&&recovery.gitContentUnchanged===unchanged&&recovery.manifestSha256===sha(blob(candidate,frozenPath)),problems:recoveryProblems,currentlyArchivedInCandidate:false,finalArchiveRequiredAsCoordinatorPlanned:true};
const productionPath=prefix+'/M11-C23-RELEASE-CANDIDATE/attempt-001/production-inputs.json',production=json(productionPath);
const priorPath='docs/里程碑/M11_应用接入标准化/验收/证据/并行测试/M11-C7-20261101T191439Z-e388/M11-C7-PACKAGE/attempt-001/production-inputs.json';
const oldProduction=json(priorPath),oldFiles=new Map(oldProduction.files.map(f=>[f.path,f]));
batch(candidate,production.files.map(f=>f.path));
const productionProblems=[],softwareProductionProblems=[],changed=[];
for(const file of production.files){const bytes=blob(candidate,file.path);if(!bytes||sha(bytes)!==file.sha256)productionProblems.push({path:file.path,code:'CANDIDATE_PRODUCTION_HASH_MISMATCH'});if(oldFiles.get(file.path)?.sha256!==file.sha256)changed.push(file.path);const software=await readFile('/private/tmp/willyou-m11-c23-2637/software-source-attempt-002/'+file.path);if(sha(software)!==file.sha256)softwareProductionProblems.push({path:file.path,code:'ACTIVE_SOFTWARE_PRODUCTION_HASH_MISMATCH'});}
const changes=JSON.parse(await readFile('/private/tmp/willyou-m11-c23-2637/test-only-corrections.json','utf8'));
const tests=[];for(const file of changes.changes){const candidateBytes=blob(candidate,file.path),software=await readFile('/private/tmp/willyou-m11-c23-2637/software-source-attempt-002/'+file.path);tests.push({path:file.path,expectedAfter:file.afterSha256,candidateSha256:sha(candidateBytes),softwareSha256:sha(software),matches:sha(candidateBytes)===file.afterSha256&&sha(software)===file.afterSha256});}
const packageValue=JSON.parse(blob(candidate,'package.json'));const priorPackage=JSON.parse(blob(base,'package.json'));const normalized={...packageValue,version:priorPackage.version};
const packageComparison={version:packageValue.version,previous:priorPackage.version,onlyVersionChanged:JSON.stringify(normalized)===JSON.stringify(priorPackage)};
const refs=git(['for-each-ref','--format=%(refname) %(objectname)','refs/tags','refs/remotes/origin/feature/0.1.0']).toString();
const versions=[...refs.matchAll(/^refs\/tags\/v(\d+)\.(\d+)\.(\d+) /gm)].map(x=>x.slice(1).map(Number)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);const latest=versions.at(-1),next=[...latest];if(++next[2]===10){next[2]=0;if(++next[1]===100){next[1]=0;next[0]++;}}
const report={schema:'v010-candidate-readonly-audit-v1',candidate,branch:'feature/0.1.0',auditedAt:new Date().toISOString(),scope:'C23 fixed Git candidate only; no App/native/Codex/test/build; no real source/profile/config accessed',archive:{files:archivePaths.length,manifests:manifestChecks.length,manifestProblems,checks:manifestChecks},privacy,authority:counts,sourceRecovery,production:{count:production.files.length,priorCount:oldProduction.files.length,changedRelativeToC7:changed,candidateProblems:productionProblems,softwareProductionProblems,packageComparison},fourTests:tests,versions:{localLatest:latest.join('.'),next:next.join('.'),candidateHasTag:refs.split('\n').some(x=>x.startsWith('refs/tags/')&&x.endsWith(' '+candidate)),remoteTrackingTipIsCandidate:refs.includes('refs/remotes/origin/feature/0.1.0 '+candidate),remoteTagResyncAtReleaseIsCoordinatorGate:true},commands};
await writeFile(output+'/automated-observations.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({candidate,archiveFiles:archivePaths.length,manifests:manifestChecks.length,manifestProblems,privacyFindings:privacy.findings,sourceRecovery,production:report.production,fourTests:tests,authority:counts,versions:report.versions}));
