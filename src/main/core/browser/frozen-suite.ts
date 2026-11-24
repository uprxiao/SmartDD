import {constants} from 'node:fs';
import {mkdir,open,realpath,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {browserDigest} from './artifacts';

const sha256=z.string().regex(/^[0-9a-f]{64}$/);
const identifier=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const manifestDocument=z.looseObject({
  schema:z.literal('source-ui-baseline-v2'),
  revision:sha256,
  entries:z.array(z.looseObject({file:z.string(),sha256})).min(1).max(512),
  sources:z.array(z.looseObject({snapshot:z.string(),sha256})).max(512),
});
const scriptMap=z.looseObject({
  suiteFile:z.string(),
  suiteSha256:sha256,
  casesSha256:sha256,
  cases:z.array(z.looseObject({
    id:identifier,handler:z.string().nullable(),status:z.string(),
    operations:z.array(z.string().min(1).max(128)).max(128).default([]),
  })).max(1000),
});
const caseFile=z.looseObject({
  cases:z.array(z.looseObject({id:identifier})).max(1000),
});
const resumePlan=z.strictObject({
  schema:z.literal('willyou-browser-resume-v1'),
  entries:z.array(z.strictObject({
    caseId:identifier,stepId:identifier,handler:identifier,
    selector:z.string().trim().min(1).max(512),text:z.string().min(1).max(512).optional(),
  })).max(128),
});
const requiredFiles=['cases.json','script-map.json'];
const maxFile=8*1024*1024;
const maxBundle=32*1024*1024;

const invalid=(message:string)=>new ApplicationError('INVALID_INPUT',message);
function bundlePath(path:string){
  if(path.length>512||path.split('/').some(name=>!name||name==='.'||name==='..'||!/^[-_a-zA-Z0-9.]+$/.test(name)))
    throw invalid('测试包中有无效的相对路径');
  return path;
}
function inside(root:string,path:string){
  const rel=relative(root,path);
  return !!rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
}
async function readBounded(path:string,budget:number){
  if(await realpath(path)!==path)throw new ApplicationError('SCOPE_DENIED','测试包拒绝符号链接');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>budget)throw invalid('测试包文件超出大小限制');
    const data=Buffer.alloc(stat.size+1);
    let offset=0;
    while(offset<data.length){
      const {bytesRead}=await handle.read(data,offset,data.length-offset,offset);
      if(!bytesRead)break;
      offset+=bytesRead;
    }
    if(offset!==stat.size)throw invalid('读取期间测试包发生变化');
    return data.subarray(0,offset);
  }finally{await handle.close();}
}
function json(data:Buffer){
  try{return JSON.parse(data.toString('utf8')) as unknown;}
  catch{throw invalid('测试包资料包含无效 JSON');}
}

/** Capture the bytes being approved or dispatched. No suite module is ever
 * imported by the Electron main process. */
export async function readFrozenSuite(taskRoot:string,input:{bundle:string;revision:string;cases:string[]}){
  const root=await realpath(taskRoot);
  const directory=resolve(root,input.bundle);
  if(!inside(root,directory)||await realpath(directory)!==directory)
    throw new ApplicationError('SCOPE_DENIED','冻结包必须位于当前任务工作目录，且不能通过链接访问');
  const manifestBytes=await readBounded(join(directory,'manifest.json'),1024*1024);
  const raw=json(manifestBytes);
  const {schema,revision,entries,sources}=manifestDocument.parse(raw);
  // Preserve the exact serialized member order used by the Skill.
  const original=raw as {entries:unknown;sources:unknown};
  if(revision!==input.revision||revision!==browserDigest(JSON.stringify({entries:original.entries,sources:original.sources})))
    throw new ApplicationError('INTENT_STALE','冻结测试包清单摘要已变化');
  const files=new Map<string,Buffer>([['manifest.json',manifestBytes]]);
  let budget=maxBundle-manifestBytes.length;
  for(const {path,hash} of [...entries.map(e=>({path:e.file,hash:e.sha256})),...sources.map(s=>({path:s.snapshot,hash:s.sha256}))]){
    bundlePath(path);
    if(files.has(path))throw invalid('冻结测试包包含重复路径');
    const bytes=await readBounded(join(directory,path),Math.min(maxFile,budget));
    if(browserDigest(bytes)!==hash)throw new ApplicationError('INTENT_STALE','冻结测试包文件摘要已变化');
    budget-=bytes.length;
    files.set(path,bytes);
  }
  if(requiredFiles.some(path=>!files.has(path)))throw invalid('冻结测试包缺少用例或运行入口');
  const mapping=scriptMap.parse(json(files.get('script-map.json')!));
  const cases=caseFile.parse(json(files.get('cases.json')!)).cases;
  const suiteFile=files.get(bundlePath(mapping.suiteFile));
  if(!suiteFile||!mapping.suiteFile.endsWith('.mjs')||mapping.suiteSha256!==browserDigest(suiteFile)
    ||mapping.casesSha256!==browserDigest(files.get('cases.json')!))
    throw invalid('冻结测试包入口和用例摘要不一致');
  const names=cases.map(test=>test.id);
  if(new Set(names).size!==names.length||new Set(mapping.cases.map(row=>row.id)).size!==mapping.cases.length)
    throw invalid('冻结包用例或运行入口存在重复编号');
  const selected=input.cases.map(id=>{
    const test=cases.find(candidate=>candidate.id===id);
    const entry=mapping.cases.find(row=>row.id===id);
    if(!test||!entry||!entry.handler||entry.status!=='implemented')throw invalid('所选用例缺少可执行入口');
    return{id,handler:entry.handler,operations:entry.operations};
  });
  const resumeBytes=files.get('willyou-resume.json');
  const resume=resumeBytes?resumePlan.parse(json(resumeBytes)).entries:[];
  const keys=resume.map(entry=>entry.caseId+'\0'+entry.stepId);
  if(new Set(keys).size!==keys.length||resume.some(entry=>!names.includes(entry.caseId)))
    throw invalid('续接入口必须唯一且属于原用例');
  return{schema,revision,suite:mapping.suiteFile,selected,files,resume};
}

export async function writeFrozenSuite(directory:string,files:ReadonlyMap<string,Buffer>){
  for(const [file,bytes] of files){
    const path=join(directory,bundlePath(file));
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    await writeFile(path,bytes,{flag:'wx',mode:0o400});
  }
}
