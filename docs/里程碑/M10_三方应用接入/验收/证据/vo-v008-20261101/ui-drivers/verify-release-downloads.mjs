// Final download audit, reusing the repository's producer/provenance verifier.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyArtifacts} from '/private/tmp/willyou-v008-integration-4q23427h/worktree/scripts/release/artifacts.mjs';
import {releasePolicy} from '/private/tmp/willyou-v008-integration-4q23427h/worktree/scripts/release/policy.mjs';
const[dir,version,commit,releaseJson,output]=process.argv.slice(2);assert(dir?.startsWith('/private/tmp/')&&/^[a-f0-9]{40}$/.test(commit));
const policy=releasePolicy(),release=JSON.parse(readFileSync(releaseJson,'utf8'));
assert.equal(policy.channel,'preview');assert.equal(release.tag_name,'v'+version);assert.equal(release.draft,false);assert.equal(release.prerelease,true);
const verified=verifyArtifacts(dir,version,commit,policy);assert.equal(readFileSync(join(dir,'SHA256SUMS.txt'),'utf8'),verified.checksums);
const expected=[...verified.files.map(path=>basename(path)),'SHA256SUMS.txt'].sort(),assets=release.assets??[];
assert.equal(expected.length,12);assert.deepEqual(assets.map(v=>v.name).sort(),expected);assert.deepEqual(readdirSync(dir).filter(v=>statSync(join(dir,v)).isFile()).sort(),expected);
const files=[];
for(const name of expected){const path=join(dir,name),asset=assets.find(v=>v.name===name),bytes=statSync(path).size,sha256=createHash('sha256').update(readFileSync(path)).digest('hex');assert.equal(bytes,asset.size);assert.equal(asset.digest,'sha256:'+sha256);files.push({name,bytes,sha256,githubAssetId:asset.id,githubDigest:asset.digest});}
const result={schema:'m10-v008-published-download-audit-v1',at:new Date().toISOString(),version,commit,url:release.html_url,draft:release.draft,prerelease:release.prerelease,producerManifests:4,installationPackages:7,totalAssets:files.length,totalBytes:files.reduce((n,v)=>n+v.bytes,0),provenanceAndChecksums:'passed',githubDigestAndSize:'passed',files};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({version,commit,assets:files.length,totalBytes:result.totalBytes,status:'passed'}));
