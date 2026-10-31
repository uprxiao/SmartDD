// Offline, read-only bridge from the actual native JSONL to the production parser.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {codexSkillDiscoveryEvidence} from '../../../src/main/core/applications/codex-skill-discovery-evidence';
const resultPath=process.argv[2];assert(resultPath.startsWith('/private/tmp/willyou-m10-dynamic-plugin-'));
const actual=JSON.parse(readFileSync(resultPath,'utf8'));assert.equal(actual.status,'passed-native-layer');
const lines=(actual.nativeSessionFiles as string[]).flatMap(path=>{assert(path.startsWith(actual.root+'/'));return readFileSync(path,'utf8').trimEnd().split('\n');});
const target={id:'selected-v1',nativeName:'read-v1',path:actual.paths.v1,content:'not a reading assertion'},after=Date.parse(actual.installStartedAt),end=Date.parse(actual.finishedAt);
const observations=codexSkillDiscoveryEvidence(lines,[target],after,end);assert.equal(observations.length,1);
const matched=lines.find(line=>createHash('sha256').update(line).digest('hex')===observations[0].recordHash);assert(matched);
const record=JSON.parse(matched);assert(record.payload.content.some((c:{type:string;text?:string})=>c.type==='input_text'&&c.text?.includes('late-user:late-skill')));
assert.deepEqual(codexSkillDiscoveryEvidence(lines,[{...target,path:actual.paths.v2}],after,end),[]);
console.log(JSON.stringify({layer:'Read-only actual native JSONL -> unmodified production discovery-evidence parser; not App or Skill-reading evidence',root:actual.root,startedAt:actual.installStartedAt,finishedAt:actual.finishedAt,observations,selectedExactPath:target.path,matchedNativeRecordContainsNewUserPlugin:true,disabledWrongPathRejected:true,nativeRecords:lines.length}));
