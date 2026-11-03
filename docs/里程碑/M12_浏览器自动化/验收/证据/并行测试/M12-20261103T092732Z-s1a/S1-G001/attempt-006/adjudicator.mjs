import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 result directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const find=(...command)=>raw.steps.find(step=>command.every((part,index)=>step.args[index]===part));
const error=(step,code,exit,effect)=>step?.raw.code===exit&&step.parsed?.error?.code===code&&step.parsed.error.effectState===effect;
const snapshot=raw.steps.filter(step=>step.args[1]==='snapshot').at(-1)?.parsed?.data;
const capture=find('browser','full-screenshot')?.parsed?.data;
let screenshotVerified=false;
if(capture?.file){const bytes=await readFile(capture.file.path);screenshotVerified=createHash('sha256').update(bytes).digest('hex')===capture.file.sha256&&bytes.length===capture.file.bytes&&bytes.readUInt32BE(16)===capture.width&&bytes.readUInt32BE(20)===capture.height&&capture.height>=2800;}
const checks={
  commandCatalog:find('--list')?.parsed?.capabilities?.length===13,
  noTabCode:error(raw.steps[1],'BROWSER_NO_TAB',2,'not-started'),
  snapshotMetadata:typeof snapshot?.browserPageId==='string'&&typeof snapshot?.url==='string'&&snapshot?.title==='[I] S1 real native CLI'&&snapshot.refs.some(ref=>ref.ref.startsWith('@')&&ref.role==='button'),
  clickActuallyDelivered:JSON.stringify(raw.observedAfterFill?.hits)==='["action"]',
  numericFill:raw.observedAfterFill?.value==='123',
  typeAndInsertExact:raw.observedAfterText?.value==='123test'+'中文'.repeat(16384),
  fullScreenshot:screenshotVerified,
  waitTimeout:error(raw.steps.find(step=>step.args.includes('#missing')),'BROWSER_TIMEOUT',2,'not-started'),
  execPreflight:error(find('browser','exec'),'INVALID_INPUT',2,'not-started'),
  typeLengthPreflight:error(raw.steps.find(step=>step.inputBytes===16385),'INVALID_INPUT',2,'not-started'),
  pausedPreflight:error(raw.steps.find(step=>step.parsed?.error?.code==='BROWSER_PAUSED'),'BROWSER_PAUSED',2,'not-started'),
  stalePreflight:error(raw.steps.find(step=>step.parsed?.error?.code==='BROWSER_STALE_REF'),'BROWSER_STALE_REF',2,'not-started'),
  evalUnknown:error(find('browser','eval'),'BROWSER_EVAL_ERROR',5,'unknown'),
  cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),boundary:'I preflight only, controlled run root; not full T035/T060/T107 or actual Agent',checks,passed:Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
