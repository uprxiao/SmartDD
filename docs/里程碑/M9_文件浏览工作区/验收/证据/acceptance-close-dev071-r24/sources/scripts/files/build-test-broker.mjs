// Builds unchanged production native source with its existing fault hooks.
// The resulting helper is exclusively for isolated acceptance fault variants.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
assert.equal(process.platform,'darwin');
const directory=await mkdtemp('/private/tmp/willyou-test-file-broker-'),executable=join(directory,'willyou-files-test'),source=resolve('native/files/broker.mm');
const args=['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',source,'-o',executable];
execFileSync('xcrun',args,{timeout:120000,stdio:['ignore','pipe','pipe']});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={at:new Date().toISOString(),source,sourceSha256:sha(await readFile(source)),executable,sha256:sha(await readFile(executable)),command:['xcrun',...args],compiler:execFileSync('xcrun',['clang++','--version'],{encoding:'utf8'}),arch:process.arch,boundary:'Test macro only. No changed save algorithm or fabricated native receipts; never a release artifact.'};
await writeFile(join(directory,'build.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
