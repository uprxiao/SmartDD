import {registerHooks} from 'node:module';
import {appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const target = "/Users/liubu/Documents/ChatGPT/SmartDD-m10/node_modules/.pnpm/vitest@4.1.11_@types+node@22.20.5_jsdom@30.1.3_@noble+hashes@2.4.0__vite@6.4.4_@types+n_17faef52d621732777e46e83475344fc/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js", expected = "a236001d048380e2c67d05423fc9ea3f26b07ee019ba8d6e622082f29d49102e", log = "/private/tmp/m10-legacy-recovery-r-20261021/startup-watchdog-applied.jsonl";
const original = 'const START_TIMEOUT = 6e4;', replacement = 'const START_TIMEOUT = 9e5;';
registerHooks({load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== pathToFileURL(target).href) return result;
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== expected || source.split(original).length !== 2 || !source.includes('const STOP_TIMEOUT = 6e4;')) throw new Error('Private startup adapter source mismatch; do not patch another dependency version');
  const updated = source.replace(original, replacement);
  appendFileSync(log, JSON.stringify({time:new Date().toISOString(),pid:process.pid,target,originalHash:hash,adaptedHash:createHash('sha256').update(updated).digest('hex'),change:'worker-start-only',beforeMs:60000,afterMs:900000,stopTimeoutUnchanged:true})+'\n');
  return {...result, source:updated};
}});
