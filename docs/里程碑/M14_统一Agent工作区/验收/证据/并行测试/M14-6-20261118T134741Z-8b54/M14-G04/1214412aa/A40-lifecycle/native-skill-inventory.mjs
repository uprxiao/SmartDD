import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {globSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {pluginId} from './plugin-fixture.mjs';

export const a40NativeSkill='willyou-'+pluginId+':a40-proof';

export function parseRecordedSkillListing(text,sessionId){
  const lines=text.split('\n');
  lines.pop(); // A final record may still be in the middle of its append.
  const records=lines.filter(Boolean).map(line=>JSON.parse(line));
  const listing=records.findLast(row=>row.type==='attachment'&&row.sessionId===sessionId&&row.attachment?.type==='skill_listing');
  if(!listing)return null;
  assert(Array.isArray(listing.attachment.names));
  assert(listing.attachment.names.every(name=>typeof name==='string'));
  return {recordId:listing.uuid,sessionId,primaryListing:listing.attachment.isInitial===true,
    advertised:listing.attachment.names.includes(a40NativeSkill),
    matchingNames:listing.attachment.names.filter(name=>name.includes('a40'))};
}

export function readRecordedSkillListing(userData,run){
  if(!run?.native_id)return null;
  assert(/^[a-f0-9-]{36}$/.test(run.native_id));
  assert(run.state_root?.startsWith(join(userData,'agents','claude')+'/'),'Only this isolated managed Claude profile belongs to this run');
  assert.equal(realpathSync(run.state_root),run.state_root);
  const matches=globSync(join(run.state_root,'projects','*',run.native_id+'.jsonl'));
  if(!matches.length)return null;
  assert.equal(matches.length,1);
  const [file]=matches;
  assert.equal(realpathSync(file),file);
  assert(statSync(file).size<=8*1024*1024);
  const bytes=readFileSync(file),listing=parseRecordedSkillListing(bytes.toString('utf8'),run.native_id);
  return listing&&{...listing,runId:run.run_id,path:file,traceSha256:createHash('sha256').update(bytes).digest('hex')};
}
