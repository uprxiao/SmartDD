import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private output required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const codes=['BROWSER_NO_TAB','BROWSER_UNAVAILABLE','BROWSER_STALE_REF','BROWSER_PAUSED','BROWSER_TIMEOUT','BROWSER_TAB_NOT_FOUND','BROWSER_TAB_CLOSED','BROWSER_TAB_CHANGED','BROWSER_EVAL_ERROR','BROWSER_ERROR'];
const rows=new Map((raw.errors??[]).map(row=>[row.name,row]));
const allCodes=codes.map(code=>({code,actual:rows.get(code)?.action.parsed.error?.code,passed:rows.get(code)?.action.parsed.error?.code===code}));
const checks={
 exactTenErrorCodes:allCodes.every(row=>row.passed),
 fourPreflightNoEffects:['BROWSER_PAUSED','BROWSER_STALE_REF','exec-block','type-over'].every(name=>{const row=rows.get(name);return row?.action.raw.code===2&&row.action.parsed.error.effectState==='not-started'&&row.status.hits===0;}),
 readErrors:['BROWSER_NO_TAB','BROWSER_TIMEOUT'].every(name=>{const row=rows.get(name);return row?.action.raw.code===2&&row.action.parsed.error.effectState==='read-only';}),
 submittedCloseUnknown:rows.get('BROWSER_TAB_CLOSED')?.action.raw.code===5&&rows.get('BROWSER_TAB_CLOSED').action.parsed.error.effectState==='unknown'&&rows.get('BROWSER_TAB_CLOSED').status.events.some(row=>row.event==='write-stdin-dispatched')&&rows.get('BROWSER_TAB_CLOSED').status.events.some(row=>row.event==='page-closed-after-dispatch'&&['stopped','absent'].includes(row.helper?.daemonState)),
 noSilentRetry:raw.errors?.every(row=>row.status.hits<=1)&&raw.errors.filter(row=>row.name!=='BROWSER_TAB_CLOSED').every(row=>row.status.hits===0),
 skillHasHandling:codes.every(code=>raw.skill?.split('\n').some(line=>line.startsWith('| '+code+' |')&&line.split('|')[2]?.trim().length>5)),
 cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.every(helper=>['stopped','absent'].includes(helper.daemonState)&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),case:'M12-T035',layer:'I',boundary:'actual native CLI/service/ten errors; explicit private helper-SHA mismatch, own navigation, post-stdin close latches; no mocked error replies',allCodes,checks,passed:!raw.failure&&Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
