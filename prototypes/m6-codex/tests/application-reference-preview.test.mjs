import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePreviewTerminal,previewReferenceCurrent,previewTerminalCurrent} from '../src/application-reference-preview.mjs';
const a={id:'a',ptyId:'pty-a',project:'p1',status:'running'},b={id:'b',ptyId:'pty-b',project:'p1',status:'running'},foreign={id:'f',project:'p2',status:'running'};
test('an explicitly selected foreign or stopped task never falls back to the only eligible task',()=>{
  assert.equal(capturePreviewTerminal([a,foreign],'p1','f'),null);
  assert.equal(capturePreviewTerminal([a,{...b,status:'stopped'}],'p1','b'),null);
  assert.equal(capturePreviewTerminal([a,b],'p1',null),null);
  assert.deepEqual(capturePreviewTerminal([a,b],'p1','b'),{taskId:'b',ptyId:'pty-b',projectId:'p1'});
});
test('a captured detail rejects task, project, terminal generation, stop and archive changes',()=>{
  const target=capturePreviewTerminal([a],'p1','a');assert(previewTerminalCurrent(target,[a],'p1','a'));
  assert(!previewTerminalCurrent(target,[a,b],'p1','b'));
  assert(!previewTerminalCurrent(target,[a],'p2','a'));
  assert(!previewTerminalCurrent(target,[{...a,ptyId:'replacement'}],'p1','a'));
  assert(!previewTerminalCurrent(target,[{...a,status:'stopped'}],'p1','a'));
  assert(!previewTerminalCurrent(target,[{...a,archived:true}],'p1','a'));
});
test('a source connection must retain its captured identity/revision and remain available',()=>{
  const target=capturePreviewTerminal([a],'p1','a'),binding={target,connectionId:'c1',connectionRevision:1};
  assert(previewReferenceCurrent(binding,[a],'p1','a',[{id:'c1',revision:1}]));
  assert(!previewReferenceCurrent(binding,[a],'p1','a',[{id:'c1',revision:2}]));
  assert(!previewReferenceCurrent(binding,[a],'p1','a',[{id:'c2',revision:1}]));
  assert(!previewReferenceCurrent(binding,[a],'p1','a',[]));
});
