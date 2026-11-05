// Pure package/three-hash contract. File ownership/payload proof uses frozen shared verifier.
import assert from 'node:assert/strict';
import {canonical,sha} from './plan-reader.mjs';
import {templateFilesHash,renderedFilesHash} from './skill-files-proof.mjs';
export function verifyPackageManifest({bytes,packageHash,appId,expected,sourceHash}){
 const manifest=JSON.parse(bytes.toString('utf8'));
 assert.equal(manifest.appId,appId);assert.equal(sha(canonical(manifest)),packageHash,'Canonical actual package manifest hash');
 assert.equal(templateFilesHash(manifest,expected.skillId),expected.templateHash,'Entire source Skill directory template hash');
 if(sourceHash!==undefined)assert.equal(sourceHash,expected.templateHash,'Session sourceHash must be directory template hash');
 return manifest;
}
export function verifyDeliveredRecord(target,expected,packageHash){
 assert.equal(target.appId,expected.appId);assert.equal(target.skillId,expected.skillId);assert.equal(target.nativeName,expected.nativeName);
 assert.equal(target.appPackageHash,packageHash);assert.equal(target.templateHash,expected.templateHash);
 assert.equal(target.renderedHash,expected.renderedHash);assert.equal(renderedFilesHash(target.files),expected.renderedHash);
 assert.equal(sha(Buffer.from(target.content)),target.sha256,'Read target is single SKILL.md file SHA');
 assert.equal(target.sha256,target.skillFileSha256);const entry=target.files.find(f=>f.path==='SKILL.md');
 assert(entry);assert.equal(entry.sha256,target.sha256);assert.equal(entry.size,Buffer.byteLength(target.content));
 assert.equal(sha(canonical(target.packageManifest)),packageHash);assert.equal(templateFilesHash(target.packageManifest,target.skillId),expected.templateHash);
 return true;
}
