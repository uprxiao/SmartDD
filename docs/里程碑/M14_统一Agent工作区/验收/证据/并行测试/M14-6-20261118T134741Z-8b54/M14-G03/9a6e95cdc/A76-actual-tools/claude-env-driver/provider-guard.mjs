import assert from 'node:assert/strict';

export function readRealTaskProposals(bytes,subjects,offered) {
  const frames=bytes.toString('utf8').split(/\r?\n/).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  assert(frames.some(frame=>frame?.type==='message_start')&&frames.some(frame=>frame?.type==='message_stop'),'Incomplete real provider response');
  const calls=[];
  for(const frame of frames.filter(row=>row?.type==='content_block_start'&&/(?:^|_)tool_use$/.test(row.content_block?.type??''))){
    const tool=frame.content_block;
    assert.equal(tool.type,'tool_use','No provider server-side tool calls');
    assert(['TaskCreate','TaskUpdate','TaskList'].includes(tool.name)&&offered.includes(tool.name),'Only actually advertised native task-list tools can be forwarded');
    assert(typeof tool.id==='string'&&/^[-_A-Za-z0-9]{2,180}$/.test(tool.id));
    const chunks=frames.filter(event=>event?.type==='content_block_delta'&&event.index===frame.index&&event.delta?.type==='input_json_delta');
    const args=chunks.length?JSON.parse(chunks.map(event=>event.delta.partial_json).join('')):tool.input;
    assert(args&&typeof args==='object'&&!Array.isArray(args));
    if(tool.name==='TaskCreate')assert(subjects.includes(args.subject),'Only the synthetic task subjects can be created');
    if(tool.name==='TaskUpdate'){
      assert(typeof args.taskId==='string'&&/^[-_A-Za-z0-9]{1,80}$/.test(args.taskId));
      assert(['pending','in_progress','completed'].includes(args.status),'Only progress state updates on private tasks');
      assert(Object.keys(args).every(key=>['taskId','status'].includes(key)),'Only progress state fields may be changed');
    }
    calls.push({name:tool.name,id:tool.id,subject:args.subject??null,taskId:args.taskId??null,status:args.status??null});
  }
  return calls;
}
