import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
let cleanupProof;try{cleanupProof=JSON.parse(await readFile(join(directory,'cleanup-verification.json'),'utf8'));}catch{}
const rows=new Map((raw.cases??[]).map(row=>[row.name,row]));
const hash=value=>createHash('sha256').update(value).digest('hex');
const progress=row=>row?.receipt?.progress?JSON.parse(row.receipt.progress):null;
const unknown=row=>row?.action?.raw.code===5&&row.action.parsed.error?.effectState==='unknown'&&row.receipt?.state==='unknown';
const observed=row=>{const value=progress(row)?.observed;return value?.length===row?.after?.value?.length&&value.sha256===hash(row.after.value)&&!isNaN(Date.parse(value.at));};
const full=rows.get('type-16384'),large=rows.get('inserttext-64KiB'),over=rows.get('type-16385'),boundary=rows.get('boundary'),middle=rows.get('middle-333'),selection=rows.get('selection-middle-333'),max=rows.get('maxlength-4000'),maxFault=rows.get('maxlength-interrupted'),unicode=rows.get('type-Unicode-4096');
const chunks=[...Array(8).fill(2000),384];
const checks={
 full16384:full?.action.raw.code===0&&full.input.points===16384&&hash(full.after.value)===full.input.sha256&&full.after.echo===full.after.value&&JSON.stringify(full.diagnostic.commands.map(row=>row.points))===JSON.stringify(chunks)&&progress(full)?.confirmedChars===16384,
 mixedUnicode:unicode?.action.raw.code===0&&unicode.input.points===4096&&hash(unicode.after.value)===unicode.input.sha256&&unicode.after.echo===unicode.after.value,
 over16385:over?.action.raw.code===2&&over.action.parsed.error?.code==='INVALID_INPUT'&&over.action.parsed.error.effectState==='not-started'&&/inserttext/.test(over.action.parsed.error.message)&&over.after.value===''&&over.diagnostic.commands.length===0,
 exact64KiB:large?.input.bytes===65536&&large.action.raw.code===0&&hash(large.after.value)===large.input.sha256&&large.after.echo===large.after.value,
 boundaryStops:unknown(boundary)&&progress(boundary)?.confirmedChars===2000&&!progress(boundary)?.inFlight&&boundary.after.value.length===2000&&observed(boundary),
 middleStops:unknown(middle)&&progress(middle)?.confirmedChars===2000&&progress(middle)?.inFlight?.offset===2000&&progress(middle)?.inFlight?.length===2000&&middle.after.value.length===2333&&observed(middle),
 selectionStops:unknown(selection)&&selection.before.value.length===9000&&selection.before.selectionEnd-selection.before.selectionStart===1000&&progress(selection)?.confirmedChars===2000&&selection.after.value.length===9000-1000+2333&&observed(selection),
 maxlengthHonest:unknown(max)&&max.after.value.length===3000&&observed(max),
 maxlengthInterruption:unknown(maxFault)&&maxFault.after.value.length===3000&&observed(maxFault),
 noSilentReplay:[middle,selection].every(row=>row?.after?.inputCount-(row.before.inputCount??0)===2333),
 queryUsesOwnRequestId:[boundary,middle,selection,max,maxFault].every(row=>row?.action.parsed.requestId===row?.receipt?.request_id&&row?.queried?.raw.code===0&&row.queried.parsed.data.requestId===row.receipt.request_id&&isDeepStrictEqual(row.queried.parsed.data.progress,progress(row))),
 hooksRestored:raw.diagnostics?.faults?.length===9&&raw.diagnostics.faults.every(row=>row.restored),
 cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===1&&raw.cleanup.helpers.every(helper=>(helper.daemonState==='stopped'||helper.daemonState==='absent'&&cleanupProof?.allStopped===true)&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),case:'M12-T060',layer:'I (16MiB U gate separate)',boundary:'real native keyboard/CLI/service; owned helper SIGKILL at real input threshold; exact UTF-8 payload and page value hashes; no simulated success/error replies',checks,passed:!raw.failure&&Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
