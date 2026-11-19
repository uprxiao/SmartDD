import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const root='/private/tmp/willyou-m14-stage6.WRvdST';
export const group=join(root,'g04');
export const prior=join(group,'attempt-357');
export const runtime=join(prior,'runtime-uKigbq');
export const home=join(runtime,'home');
export const userData=join(runtime,'data');
export const work=join(runtime,'project');
export const bundle=join(root,'package/mac-arm64/WillYou.app/Contents');
export const executable=join(bundle,'MacOS/WillYou');
export const commit='9a6e95cdc1003c93f04555b58cd60d8300d2a25c';
export const asar='ca01a1cc01b5a3ec5641e726101b1e09762a184f98243db7f0618a74f8fb14c9';
export const taskId='fde6f1cc-abbf-42f7-8ce4-1358f01333b6';
export const bindingId='424058f0-39d3-4bd4-9cb5-c414397c043a';
export const nativeId='4512f5e5-6359-4219-a6e0-339159e573df';
export const known=[
  'A05_FIRST_PERSISTED_ROUND_ANSWER',
  'A05_SECOND_PERSISTED_ROUND_ANSWER',
];
export const transcriptHash='922dc8a2c55054f0d2d025d6e6afb75d3c09203dbcafe9562e8ad3845223c59c';
export const knownBash='call_00_UiH3SPc8tqDvvDsPdKfO9376';
export const knownCommand='/bin/bash '+join(work,'only-this-fixture-background.sh');
export const expectedAnswer=known.join(' | ');
export const model='deepseek-flash';
export const providerOrigin='http://127.0.0.1:3425';
export const upstream='https://api.deepseek.com/anthropic/v1/messages';
export const title='A05 isolated native background';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const frozenFiles={
  'result.json':'48f317e5f181f77027aae5de953a12139cae67572ba4b23e95246f9e385c0981',
  'verified-release.json':'7732d77933ce9bdb8ecf4a20518b6e6f2252429616e0fe2b0c0d7c56776e1b37',
  'source-a05-real-background-diagnostic.mjs':'6b4ba8bb5f3b27b49c3d5aee97d9fd8d4ceb6fdf7a62f822aa2c8e4f6184fc49',
  'source-a05-tool-contract.mjs':'1aefb02a7826b0be2b3847b0946a67817c920bf9c80104225e802859c09b1f33',
};
export const priorGenerations=[1,2];
export function evidencePath(name){
  assert.match(name??'',/^attempt-\d{3}$/);
  assert(!['attempt-357','attempt-358'].includes(name),'Use a fresh evidence folder; 357 is the original data and 358 is independent');
  return join(group,name);
}

export function newPrompt(nonce) {
  assert.match(nonce,/^[a-f0-9]{32}$/);
  const marker='M14_A05_COLD_RESUME_'+nonce;
  const text=marker+' From this same conversation, retrieve the exact two answers you wrote in the first two completed rounds, before any background command. In order, copy only the two full answer strings on one line separated by a space, a pipe, and a space. If you cannot see them, reply HISTORY_UNAVAILABLE. Do not use any tools.';
  assert(known.every(value=>!text.includes(value)));
  return {marker,text};
}

function blocks(message) {
  if(typeof message?.content==='string')return [{type:'text',text:message.content}];
  return Array.isArray(message?.content)?message.content:[];
}

export function nativeHistory(transcript, prompt) {
  const raw=transcript.toString();
  const rows=raw.trimEnd().split('\n').map(line=>JSON.parse(line));
  const messages=rows.filter(row=>['user','assistant'].includes(row.type)&&row.sessionId===nativeId);
  const values=messages.filter(row=>row.type==='assistant').flatMap(row=>blocks(row.message))
    .filter(block=>block.type==='text').map(block=>block.text?.trim());
  assert(known.every(value=>values.includes(value)),'Native saved conversation lost historic assistant answers');
  if(prompt) {
    assert.equal(messages.filter(row=>row.type==='user').flatMap(row=>blocks(row.message)).filter(block=>block.type==='text'&&block.text.includes(prompt.text)).length,1,
      'Native transcript must contain one new cold-resume input');
    assert.equal(values.filter(value=>value===expectedAnswer).length,1,'Native transcript lacks exactly one new combined answer');
  }
  return {rows:rows.length,mainRunMessages:messages.length,sha256:sha(transcript),bytes:transcript.length};
}

export function modelRequest(raw, prompt) {
  const request=JSON.parse(raw.toString());
  assert.equal(request.model,model);
  assert.equal(request.stream,true);
  assert(Array.isArray(request.messages));
  assert(!/WillYou 历史交接/.test(JSON.stringify(request.messages)),'Same binding must supply native history without a WillYou handoff');
  const texts=request.messages.flatMap(message=>blocks(message)
    .filter(block=>block.type==='text')
    .map(block=>({role:message.role,text:block.text})));
  const lastUser=texts.filter(item=>item.role==='user').at(-1);
  assert(lastUser?.text?.includes(prompt.text),'Latest actual native user prompt does not match the expected cold resume');
  assert.equal(texts.filter(item=>item.role==='user'&&item.text.includes(prompt.marker)).length,1,'Unique fixture marker instead of stale or repeated input');
  assert(known.every(value=>!lastUser.text.includes(value)),'Cold resume prompt carried an old expected answer');
  const historicMatches=known.map(value=>texts.findIndex(item=>item.role==='assistant'&&item.text?.trim()===value));
  assert(historicMatches[0]>=0 && historicMatches[0]<historicMatches[1],'Exact first two assistant answers must come from persisted native history');
  const historicalCalls=[], historicalReceipts=[];
  for (const message of request.messages) {
    assert(['user','assistant'].includes(message.role));
    for (const block of blocks(message)) {
      assert(!['image','document','file','server_tool_use','web_search_tool_result'].includes(block.type),'Unknown or non-text source in isolated test');
      if(block.type==='tool_use'){
        assert(message.role==='assistant'&&block.name==='Bash'&&block.id===knownBash&&block.input?.command===knownCommand&&block.input?.run_in_background===true,
          'Unexpected historical tool request');
        historicalCalls.push(block.id);
      }
      if(block.type==='tool_result'){
        assert(message.role==='user'&&block.tool_use_id===knownBash&&!block.is_error,'Unexpected historical tool receipt');
        assert(typeof block.content==='string'||(Array.isArray(block.content)&&block.content.every(row=>row.type==='text')),
          'Historical Bash receipt is not plain text');
        historicalReceipts.push(block.tool_use_id);
      }
    }
  }
  assert(historicalCalls.length<=1&&historicalReceipts.length<=1,'Repeated historical Bash call or receipt');
  return {bytes:raw.length,sha256:sha(raw),model:request.model,marker:prompt.marker,
    historyFacts:known.map((value,index)=>({sourceRole:'assistant', position:historicMatches[index],factSha256:sha(value)})),
    pastToolCalls:historicalCalls.length,pastToolReceipts:historicalReceipts.length,totalMessages:request.messages.length};
}

export function verifySse(bytes) {
  const frames=bytes.toString().split(/\r?\n/).filter(line=>line.startsWith('data: '))
    .map(line=>JSON.parse(line.slice(6)));
  assert.equal(frames[0]?.type,'message_start');
  assert.equal(frames.at(-1)?.type,'message_stop');
  assert.equal(frames.filter(frame=>frame.type==='message_stop').length,1);
  assert(!frames.some(frame=>frame.type==='error'),'Supplier returned an SSE error');
  const textBlocks=new Map();
  for(const frame of frames){
    if(frame.type==='content_block_start'){
      assert(['text','thinking','redacted_thinking'].includes(frame.content_block?.type),'Supplier offered a tool in a text-only resume');
      if(frame.content_block.type==='text')textBlocks.set(frame.index,frame.content_block.text??'');
    }
    if(frame.type==='content_block_delta'){
      assert(['text_delta','thinking_delta','signature_delta'].includes(frame.delta?.type),'Supplier offered a non-text structured payload');
      if(frame.delta.type==='text_delta'){
        assert(textBlocks.has(frame.index)&&typeof frame.delta.text==='string');
        textBlocks.set(frame.index,textBlocks.get(frame.index)+frame.delta.text);
      }
    }
  }
  assert.equal(frames.findLast(frame=>frame.type==='message_delta')?.delta?.stop_reason,'end_turn');
  const text=[...textBlocks.values()].join('').trim();
  assert.equal(text,expectedAnswer,'Actual supplier answer did not recall both original facts');
  return {text,sha256:sha(bytes),bytes:bytes.length,stopReason:'end_turn',toolCalls:0};
}

export function resumeFlag(argv){
  const launch=argv.match(/(?:^|\s)--resume(?:=|\s+)([a-f0-9-]{36})(?=\s|$)/);
  return {sessionId:launch?.[1]??null, generatedSessionOption:/(?:^|\s)--session-id(?:=|\s)/.test(argv)};
}

