// U direct frozen production parser; no native/browser process.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {matrix} from './matrix.mjs';
const root='/private/tmp/willyou-m12-t039-executor-001',require=createRequire(import.meta.url),{browserExecArguments}=require(root+'/unit-build/exec-policy.cjs'),data=matrix(49231),raw={layer:'U',at:new Date().toISOString(),negative:[],positive:[],unitBundleSha256:createHash('sha256').update(await readFile(root+'/unit-build/exec-policy.cjs')).digest('hex')};
for(const row of data.negative){try{raw.negative.push({...row,actual:browserExecArguments(row.command)})}catch(e){raw.negative.push({...row,error:{code:e.code,message:e.message}})}}for(const row of data.positive){try{raw.positive.push({...row,actual:browserExecArguments(row.command)})}catch(e){raw.positive.push({...row,error:{code:e.code,message:e.message}})}}
await writeFile(root+'/unit.raw.json',JSON.stringify(raw,null,2)+'\n');console.log(JSON.stringify({negative:raw.negative.length,positive:raw.positive.length}));
