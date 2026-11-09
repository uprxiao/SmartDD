import {readFile,writeFile} from 'node:fs/promises';
import {adjudicate} from './adjudicate-corrected.mjs';
const root='/private/tmp/willyou-m12-p118-app022-installer-001/installed-startup-001',parent='/private/tmp/willyou-m12-p118-app022-installer-001';
const load=async p=>JSON.parse(await readFile(p));
const verdict=adjudicate({r:await load(root+'/raw.json'),cleanup:await load(root+'/cleanup.json'),pin:await load(root+'/pin.json'),installation:await load(parent+'/evidence/install-and-compare-result.json'),native:await load(parent+'/evidence/installed-native-result.json')});
await writeFile(root+'/postmortem-review-001/adjudication.json',JSON.stringify({safeForRepo:true,verdict,originalJudgePreserved:root+'/result.json',onlyChange:'old attempt002 suffix replaced by exact current Rootuserdata; allother assertions unchanged',executionRepeated:false,formalCaseIncrement:0},null,2)+'\n');
console.log(JSON.stringify({passed:verdict.checks.filter(x=>x.passed).length,total:verdict.checks.length,originalPreserved:true}));if(!verdict.passed)process.exitCode=1;
