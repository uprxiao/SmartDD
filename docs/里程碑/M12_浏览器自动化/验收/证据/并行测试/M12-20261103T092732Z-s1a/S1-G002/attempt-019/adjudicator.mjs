import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const serial=raw.serial??[],parallel=raw.parallel??[],events=raw.afterParallel?.events??[];
const requestLabels=new Map(serial.map(item=>[item.result.parsed?.operation?.requestId,item.label]));
const arrival=(raw.afterSerial?.operations??[]).filter(row=>requestLabels.has(row.request_id)).map(row=>requestLabels.get(row.request_id));
const starts=events.filter(event=>event.phase==='start'&&event.label?.startsWith('serial-'));
const interval=label=>{const selected=events.filter(event=>event.label===label);return selected.length===2&&selected[0].phase==='start'&&selected[1].phase==='end'?selected:null;};
const serialIntervals=starts.map(event=>interval(event.label));
const one=interval('parallel-a'),two=interval('parallel-b');
const durations=one&&two?[one[1].at-one[0].at,two[1].at-two[0].at]:[];
const checks={
  allNativeCallsSucceeded:serial.length===3&&parallel.length===2&&[...serial,...parallel].every(item=>item.result.raw.code===0&&!item.result.raw.timedOut&&item.result.parsed?.data?.value===item.label),
  distinctPages:raw.pages?.length===2&&raw.pages[0]!==raw.pages[1],
  fifoArrivalOrder:arrival.length===3&&JSON.stringify(arrival)===JSON.stringify(starts.map(event=>event.label)),
  samePageNonoverlap:serialIntervals.length===3&&serialIntervals.every(Boolean)&&serialIntervals.every((pair,index)=>index===0||serialIntervals[index-1][1].at<=pair[0].at),
  singlePageDuration:raw.serialMs>=6000&&raw.serialMs<8000,
  twoPageOverlap:Boolean(one&&two&&Math.max(one[0].at,two[0].at)<Math.min(one[1].at,two[1].at)),
  parallelNearOneCommand:durations.length===2&&durations.every(ms=>ms>=1950&&ms<3000)&&raw.parallelMs<=Math.max(...durations)+1000,
  noRepeatedWork:events.length===10&&['serial-1','serial-2','serial-3','parallel-a','parallel-b'].every(label=>interval(label)!==null),
  cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===2&&raw.cleanup.helpers.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const passed=Object.values(checks).every(Boolean),verdict={at:new Date().toISOString(),boundary:'I real BrowserService/M11 native CLI, two helper-connected pages, actual site network timing and SQLite arrival order; controlled run root',checks,serialMs:raw.serialMs,parallelMs:raw.parallelMs,siteCommandDurations:durations,arrivalOrder:arrival,siteStartOrder:starts.map(event=>event.label),case:'M12-T038',passed};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
