import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,json,save,lease} from './io.mjs';
assert.deepEqual(process.argv.slice(2),['--verify']);lease(true);
const execution=json(path.join(ROOT,'execution.json')),events=fs.readdirSync(path.join(ROOT,'output')).filter(x=>/^process-\d+\.jsonl$/.test(x)).flatMap(x=>fs.readFileSync(path.join(ROOT,'output',x),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const identities=new Map([[execution.driverPID,{kind:'driver'}],[execution.runnerPID,{kind:'runner'}]]);
for(const e of events){if(e.event==='process-start')identities.set(e.pid,{kind:'observed-own-node',execPath:e.execPath});if(e.event==='spawn'&&e.childPID)identities.set(e.childPID,{kind:e.isExactBroker?'exact-app026-broker':'tool-child',execPath:e.executable});}
const pids=[...identities.keys()].filter(Number.isInteger),checks=[];
for(const pid of pids){const r=spawnSync('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,lstart=,comm='],{encoding:'utf8'});const absent=r.status===1&&!r.stdout.trim()&&!r.stderr.trim();checks.push({pid,...identities.get(pid),absent,status:r.status,observed:r.stdout.trim(),stderr:r.stderr.trim()});}
const r=spawnSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'});assert.equal(r.status,0,'independent descendant check failed');
const rows=r.stdout.split('\n').map(x=>x.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(m=>({pid:Number(m[1]),ppid:Number(m[2]),comm:m[3]}));
const descendants=rows.filter(x=>pids.includes(x.ppid)&&x.pid!==process.pid);
const result={at:new Date().toISOString(),method:'independent ps exact observed PIDs and surviving direct descendants; no argv/env read, no port probe or signal',checks,descendants,allClear:checks.every(x=>x.absent)&&descendants.length===0,resourcesHeld:!(checks.every(x=>x.absent)&&descendants.length===0),signalsSent:[],AppStarted:false,listenersStarted:false};save('cleanup.json',result);console.log(JSON.stringify({checks:checks.length,allClear:result.allClear,descendants:descendants.length}));if(!result.allClear)process.exitCode=1;
