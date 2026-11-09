import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 result directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const find=(...command)=>raw.steps.find(step=>command.every((part,index)=>step.args[index]===part));
const error=(step,code,exit,effect)=>step?.raw.code===exit&&step.parsed?.error?.code===code&&step.parsed.error.effectState===effect;
const snapshot=raw.steps.filter(step=>step.args[1]==='snapshot').at(-1)?.parsed?.data;
const capture=find('browser','full-screenshot')?.parsed?.data;
let screenshotVerified=false;
if(capture?.file){
  const bytes=await readFile(capture.file.path), compressed=[];
  let offset=8,complete=false;
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(offset+12+length>bytes.length)break;if(type==='IDAT')compressed.push(bytes.subarray(offset+8,offset+8+length));offset+=12+length;if(type==='IEND'){complete=offset===bytes.length;break;}}
  let decoded=false;try{decoded=inflateSync(Buffer.concat(compressed)).length>0;}catch{}
  screenshotVerified=complete&&decoded&&createHash('sha256').update(bytes).digest('hex')===capture.file.sha256&&bytes.length===capture.file.bytes&&bytes.readUInt32BE(16)===capture.width&&bytes.readUInt32BE(20)===capture.height&&capture.height>=4*700*(capture.width/1000)&&capture.file.path.startsWith(join(directory,'userData/browser/artifacts',raw.ready.taskId)+'/')&&capture.format==='png'&&!Object.hasOwn(capture,'base64');
}
const checks={
  commandCatalog:find('--list')?.parsed?.capabilities?.length===13,
  noTabCode:error(raw.steps[1],'BROWSER_NO_TAB',2,'read-only'),
  snapshotMetadata:typeof snapshot?.browserPageId==='string'&&typeof snapshot?.url==='string'&&snapshot?.title==='[I] S1 real native CLI'&&snapshot.refs.some(ref=>ref.ref.startsWith('@')&&ref.role==='button'),
  clickActuallyDelivered:JSON.stringify(raw.observedAfterFill?.hits)==='["action"]',
  numericFill:raw.observedAfterFill?.value==='123',
  typeAndInsertExact:raw.observedAfterText?.value==='123test'+'中文'.repeat(16384),
  fullScreenshot:screenshotVerified,
  waitTimeout:error(raw.steps.find(step=>step.args.includes('#missing')),'BROWSER_TIMEOUT',2,'read-only'),
  execPreflight:error(find('browser','exec'),'INVALID_INPUT',2,'not-started'),
  typeLengthPreflight:error(raw.steps.find(step=>step.inputBytes===16385),'INVALID_INPUT',2,'not-started'),
  pausedPreflight:error(raw.steps.find(step=>step.parsed?.error?.code==='BROWSER_PAUSED'),'BROWSER_PAUSED',2,'not-started'),
  stalePreflight:error(raw.steps.find(step=>step.parsed?.error?.code==='BROWSER_STALE_REF'),'BROWSER_STALE_REF',2,'not-started'),
  evalUnknown:error(find('browser','eval'),'BROWSER_EVAL_ERROR',5,'unknown'),
  cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const treeRefs=snapshot?.snapshot?.match(/ref=(@[^\]\s,]+)/g)?.map(value=>value.slice(4))??[];
const declaredRefs=snapshot?.refs?.map(item=>item.ref)??[];
const created=find('browser','tab','create')?.parsed?.data;
const cases={
  'M12-T050':{
    layer:'I',passed:false,
    partial:checks.snapshotMetadata&&snapshot.browserPageId===created?.pageId&&snapshot.url===raw.ready.url&&declaredRefs.length>0&&declaredRefs.every(ref=>/^@k[0-9a-z]+s\d+e\d+$/.test(ref))&&JSON.stringify([...treeRefs].sort())===JSON.stringify([...declaredRefs].sort()),
    scope:'Only button and textbox exercised; full F-SITE form also requires contenteditable, select, checkbox and file input coverage before closing T050',
  },
  'M12-T055':{layer:'I',passed:screenshotVerified,scope:'1000x700 CSS viewport, page 3038 CSS px; complete decodable PNG, actual pixel dimensions/format/path/bytes/hash and task directory verified'},
};
const verdict={at:new Date().toISOString(),boundary:'I composition with controlled run root; selected complete I cases only; not full T035/T060/T107 or actual Agent',checks,cases,passed:Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
