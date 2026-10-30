import {spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
const steps=[['inline','scripts/files/markdown-inline-ui.mjs',{WILLYOU_INLINE_PROTOTYPE:'1'}],['math','scripts/files/markdown-math-selection-ui.mjs',{WILLYOU_MATH_SELECTION_PROTOTYPE:'1'}],['events','scripts/files/markdown-events-prototype.mjs',{}]];
const rows=[];
for(const[name,script,extra]of steps){const log='/private/tmp/willyou-dev117-prototype-'+name+'-verified.log',fd=openSync(log,'wx');const result=spawnSync(process.execPath,[script],{env:{...process.env,...extra},stdio:['ignore',fd,fd]});closeSync(fd);rows.push({name,script,log,code:result.status,signal:result.signal,error:result.error?.message});console.log(JSON.stringify(rows.at(-1)));if(result.status!==0){process.exitCode=1;break;}}
writeFileSync('/private/tmp/willyou-dev117-prototype-suite.json',JSON.stringify(rows,null,2)+'\n');
