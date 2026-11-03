import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const stale=action=>action?.raw?.code===2&&action.parsed?.error?.code==='BROWSER_STALE_REF'&&action.parsed.error.effectState==='not-started';
const cases=raw.identityCases??[],negative=['replace','insert','reorder','rename','navigation','old-generation','snapshot-continuous','snapshot-aba'];
const once=cases.find(row=>row.name==='snapshot-once'),continuous=cases.find(row=>row.name==='snapshot-continuous'),aba=cases.find(row=>row.name==='snapshot-aba');
const race=mode=>raw.snapshotRaces?.races?.find(record=>record.mode===mode);
const observedHelper=(record)=>record?.captures?.length===record?.iterations?.length&&record.iterations.every((step,index)=>record.captures[index].length===1&&record.captures[index][0]===step.helper);
const actionRef=row=>row?.snapshot?.parsed?.data?.refs?.find(ref=>ref.role==='button'&&ref.name==='Action');
const checks={
  normalControl:raw.normal?.action?.raw.code===0&&JSON.stringify(raw.normal?.observed?.hits)==='["action"]',
  staleMutationsAndGenerations:negative.every(name=>{const row=cases.find(item=>item.name===name);return row&&stale(row.action)&&row.observed.hits.length===0;}),
  crossPage:stale(raw.crossPage?.action)&&raw.crossPage.aObserved.hits.length===0&&raw.crossPage.bObserved.hits.length===0&&raw.crossPage.a.parsed.data.refs[0].ref!==raw.crossPage.b.parsed.data.refs[0].ref&&raw.crossPage.a.parsed.data.refs[0].ref.match(/e\d+$/)?.[0]===raw.crossPage.b.parsed.data.refs[0].ref.match(/e\d+$/)?.[0],
  continuousRetryBound:race('continuous')?.iterations.length===3&&race('continuous').iterations.every(step=>step.before!==step.helper&&step.helper===step.after)&&observedHelper(race('continuous'))&&actionRef(continuous)?.available===false,
  abaNotMisbound:race('aba')?.iterations.length===3&&race('aba').iterations.every(step=>step.before===step.after&&step.before!==step.helper)&&observedHelper(race('aba'))&&actionRef(aba)?.available===false,
  freshRetryBindsOnlyNewSnapshot:race('once')?.iterations.length===2&&race('once').iterations[0].before!==race('once').iterations[0].helper&&race('once').iterations[1].before===race('once').iterations[1].helper&&race('once').iterations[1].helper===race('once').iterations[1].after&&observedHelper(race('once'))&&actionRef(once)?.available===true&&once.action.raw.code===0&&JSON.stringify(once.observed.instances)==='["race-1"]',
  postArmClick:stale(raw.postArmClick?.action)&&raw.postArmClick.observed.hits.length===0,
  postArmFill:stale(raw.postArmFill?.action)&&raw.postArmFill.observed.value==='preserve'&&raw.postArmFill.observed.inputEvents.length===raw.postArmFill.before.inputEvents.length,
  hooksRestored:raw.snapshotRaces?.races?.length===3&&raw.snapshotRaces.races.every(record=>record.restored===true),
  cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===2&&raw.cleanup.helpers.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),boundary:'I real native CLI/helper/BrowserService; main-frame controlled race gates and read-only capture observer; T051 cross-site iframe/closed-shadow still missing',checks,passed:!raw.failure&&Object.values(checks).every(Boolean),formalCase:'M12-T051',formalComplete:false};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
