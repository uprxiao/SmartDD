// Test-driver only: actual native terminal UI, one fixed local MCP call at a time.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const sha=v=>createHash('sha256').update(v).digest('hex');
const writes=new Set(['smartdd_mail_reply_create_v2','smartdd_mail_draft_create_v2','smartdd_mail_send_prepare_v2','smartdd_mail_send_cancel_v2','smartdd_mail_draft_update_v2','smartdd_mail_send_execute_v2']);
export function matchSingleApproval(dom,call){
 const index=dom.lastIndexOf('Field 1/1');
 if(index<0)return null;
 const prompt=dom.slice(index);
 const found=prompt.match(/Allow the (\S+) MCP server to run tool "([^"]+)"\?/);
 if(!found)return null;
 assert(writes.has(call.name),'Unapproved native write operation: '+call.name);
 assert.equal(found[1],call.namespace?.replace(/^mcp__/,''),'Unexpected approval namespace');
 assert.equal(found[2],call.name,'Unexpected approval tool');
 assert(/›\s*1\. Allow\s+Run the tool and continue/.test(prompt),'Single Allow is not the selected option');
 assert(prompt.includes('2. Allow for this session')&&prompt.includes('3. Always allow')&&prompt.includes('4. Cancel'),'Unrecognized native approval options');
 assert(prompt.includes('enter to submit | esc to cancel'),'Unrecognized approval submission');
 return prompt;
}
export function createNativeSingleApproval({app,ui,matrix,root,result}){
 const observed=new Map(),approved=new Set();
 return async()=>{
  const call=matrix.pending;
  if(!call||approved.has(call.call_id))return;
  const dom=await app.evaluate('document.body.innerText');
  const hasPrompt=/Allow the \S+ MCP server to run tool "/.test(dom.slice(dom.lastIndexOf('Field 1/1')));
  if(!writes.has(call.name)){assert(!hasPrompt,'Unexpected approval for non-whitelisted call');return;}
  const expected=matrix.expectedCalls.get(call.call_id);
  assert(expected,'No pre-issued fixed expectation for approval');
  assert.deepEqual(call,expected,'Native call changed after issue');
  if(!observed.has(call.call_id))observed.set(call.call_id,Date.now());
  const prompt=matchSingleApproval(dom,call);
  if(!prompt){assert(Date.now()-observed.get(call.call_id)<15000,'Native client approval prompt absent after 15 seconds');return;}
  // Match the exact arguments that were fixed before sending the synthetic model response.
  await matrix.validateCallApproval(call);
  const args=JSON.parse(call.arguments);
  const argumentsSha256=sha(call.arguments);
  assert.equal(argumentsSha256,sha(expected.arguments));
  const record={callId:call.call_id,namespace:call.namespace,tool:call.name,args,argumentsSha256,
   expectedBeforeIssue:true,prompt,at:new Date().toISOString(),choice:'1. Allow',
   method:'Actual terminal UI click, focus verification, one Enter; per-call only'};
  await writeFile(join(root,'approval-'+call.call_id+'.json'),JSON.stringify(record,null,2)+'\n');
  await app.screenshot(join(root,'approval-'+call.call_id+'.png'));
  await ui.click('[data-testid=task-terminal] .xterm-screen');
  await app.waitFor('document.activeElement?.classList.contains("xterm-helper-textarea")');
  // Re-read after clicking to ensure no stale/default option changed before input.
  assert.equal(matchSingleApproval(await app.evaluate('document.body.innerText'),call),prompt);
  await ui.key('Enter','Enter',13);
  approved.add(call.call_id);record.inputAt=new Date().toISOString();
  (result.matrix.nativeSingleApprovals??=[]).push(record);
 };
}
