import {registerHooks} from 'node:module';
import {appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const target = "/Users/liubu/Documents/ChatGPT/SmartDD-m10/node_modules/.pnpm/vitest@4.1.11_@types+node@22.20.5_jsdom@30.1.3_@noble+hashes@2.4.0__vite@6.4.4_@types+n_17faef52d621732777e46e83475344fc/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js", expected = "a236001d048380e2c67d05423fc9ea3f26b07ee019ba8d6e622082f29d49102e", changes = [["const START_TIMEOUT = 6e4;", "const START_TIMEOUT = 9e5;"], ["const WORKER_START_TIMEOUT = 9e4;", "const WORKER_START_TIMEOUT = 93e4;"]], log = "/private/tmp/m10-legacy-recovery-r-20261021/startup-watchdogs-v2-applied.jsonl";
registerHooks({load(url, context, nextLoad) {
  const result=nextLoad(url,context);
  if(url!==pathToFileURL(target).href)return result;
  const source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8');
  const before=createHash('sha256').update(source).digest('hex');
  if(before!==expected||!source.includes('const STOP_TIMEOUT = 6e4;'))throw new Error('Private startup adapter original source mismatch');
  let updated=source;
  for(const [from,to] of changes){if(updated.split(from).length!==2)throw new Error('Private startup adapter expected one exact constant');updated=updated.replace(from,to);}
  appendFileSync(log,JSON.stringify({time:new Date().toISOString(),pid:process.pid,target,originalHash:before,adaptedHash:createHash('sha256').update(updated).digest('hex'),change:'inner-and-outer-worker-initialization-only',innerMs:[60000,900000],outerMs:[90000,930000],stopAndProductTimeoutsUnchanged:true})+'\n');
  return {...result,source:updated};
}});
