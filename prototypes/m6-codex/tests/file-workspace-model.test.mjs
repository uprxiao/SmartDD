import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryChildren, treeKeyboardIntent, searchTreeRows, migratePrototypeSaved, openDocument, readRootView, updateRootView } from '../src/file-workspace-model.mjs';
import { workspaceScope, initialWorkspace, openFile, closeFile, restoreFile, fileKey, treeRows, FILES, searchFiles, serializeWorkspaceStore, documentKey, fileScenario, setFileScenario, editDraft, commitDraft, acceptDisk, continueConflict, captureSelection, selectionIsCurrent, applyExternalFileChange, queueSyntheticFile, refreshSyntheticDirectory, artifactModel, updateArtifactCell, updateArtifactSlide } from '../src/file-workspace-model.mjs';
test('H18 continuing a conflict retains local source against the selected disk baseline', () => {
  const initial=initialWorkspace(),key=initial.active;
  const dirty=editDraft(initial,key,'LOCAL','BASE'),conflict=setFileScenario(dirty,key,'conflict','DISK');
  const next=continueConflict(conflict,key);
  assert.equal(next.drafts[key].text,'LOCAL');assert.equal(next.drafts[key].base,'DISK');assert.equal(fileScenario(next,key),'ready');
  assert.equal(conflict.drafts[key].base,'BASE');assert.equal(continueConflict(initial,key),initial);
});
test('H18 a new external revision after continuation creates another conflict', () => {
  const roots=[{id:'main',path:'/project',hostId:'local'}],scope='test',initial=initialWorkspace(),key=initial.active;
  const state=continueConflict(setFileScenario(editDraft(initial,key,'LOCAL','BASE'),key,'conflict','DISK'),key);
  const changed=applyExternalFileChange({[scope]:state},scope,roots,key,'NEW DISK');
  assert.equal(fileScenario(changed[scope],key),'conflict');assert.equal(changed[scope].drafts[key].text,'LOCAL');assert.equal(changed[scope].drafts[key].base,'DISK');
});
test('preview replacement retains fixed tabs and activates the latest file', () => {
  let s = openFile(initialWorkspace(), 'main', 'src/main.ts');
  s = openFile(s, 'main', 'package.json');
  assert.deepEqual(s.tabs.map(t => t.path), ['AGENTS.md', 'package.json']);
  assert.equal(s.active, fileKey('main', 'package.json'));
});
test('overlapping roots reuse the first open document and its unsaved buffer', () => {
  const roots=[{id:'main',path:'/project',hostId:'local'},{id:'nested',path:'/project/docs',hostId:'local'}];
  let state=openDocument(initialWorkspace(),roots,'main','docs/a.md',true);
  state=editDraft(state,state.active,'pending','original');
  const next=openDocument(state,roots,'nested','a.md');
  assert.equal(next.tabs.length,state.tabs.length);
  assert.equal(next.active,state.active);
  assert.equal(next.drafts[next.active].text,'pending');
});
test('active root view survives persistence without needing to leave the root first', () => {
  const state=updateRootView(initialWorkspace(),{query:'需求',selected:['docs/需求.md'],scrollTop:147,focused:'docs/需求.md'});
  const restored=JSON.parse(JSON.stringify(serializeWorkspaceStore({task:state}))).task;
  assert.equal(readRootView(restored).query,'需求');
  assert.equal(readRootView(restored).scrollTop,147);
  assert.deepEqual(readRootView(restored).selected,['docs/需求.md']);
  assert.equal(readRootView(restored,'extra').query,'');
});
test('right arrow on leaf or empty expanded directory cannot move to a sibling', () => {
  const rows=[{path:'empty',folder:true},{path:'a',folder:false},{path:'b',folder:false}];
  assert.deepEqual(treeKeyboardIntent(rows,['empty'],'empty','ArrowRight'),{});
  assert.deepEqual(treeKeyboardIntent(rows,[],'a','ArrowRight'),{});
});
test('same draft callback after save remains clean; undo to base clears dirty', () => {
  const state=initialWorkspace(),key=state.active;
  assert.equal(editDraft(state,key,'saved','saved'),state);
  const changed=editDraft(state,key,'edited','saved');
  assert.equal(editDraft(changed,key,'edited','saved'),changed);
  assert.equal(editDraft(changed,key,'saved','saved').drafts[key],undefined);
});
test('double click pins; reopening pinned file never downgrades it', () => {
  let s = openFile(initialWorkspace(), 'main', 'package.json', true);
  s = openFile(s, 'main', 'package.json');
  assert.equal(s.tabs.length, 2);
  assert.equal(s.tabs[1].preview, false);
});
test('same basename and relative path in separate roots are different files', () => {
  const s = openFile(initialWorkspace(), 'extra', 'AGENTS.md', true);
  assert.equal(s.tabs.length, 2);
  assert.notEqual(fileKey('main', 'AGENTS.md'), s.active);
});
test('dirty preview survives another preview open', () => {
  let s = openFile(initialWorkspace(), 'main', 'package.json');
  s.drafts[s.active] = {
    text: 'pending'
  };
  s = openFile(s, 'main', 'src/main.ts');
  assert.equal(s.tabs.length, 3);
  assert.equal(s.drafts[fileKey('main', 'package.json')].text, 'pending');
});
test('closing active tab picks nearest remaining item and restores original position', () => {
  let s = openFile(initialWorkspace(), 'main', 'package.json', true);
  s = openFile(s, 'main', 'src/main.ts', true);
  s = closeFile(s, fileKey('main', 'package.json'));
  assert.equal(s.active, fileKey('main', 'src/main.ts'));
  s = restoreFile(s);
  assert.deepEqual(s.tabs.map(t => t.path), ['AGENTS.md', 'package.json', 'src/main.ts']);
  assert.equal(s.closed.length, 0);
});
test('close history is bounded to 25 and an empty history is a no-op', () => {
  let s = initialWorkspace();
  assert.equal(restoreFile(s), s);
  for (let i = 0; i < 30; i++) {
    s = openFile(s, 'main', `test-${i}.txt`, true);
    s = closeFile(s, s.active);
  }
  assert.equal(s.closed.length, 25);
});
test('durable prototype snapshot excludes preview routes, without mutating live state', () => {
  const s = openFile(initialWorkspace(), 'main', 'src/main.ts');
  const store = {
    build: s,
    saved: {
      x: 'data'
    }
  };
  const snapshot = serializeWorkspaceStore(store);
  assert.equal(snapshot.build.tabs.length, 1);
  assert.equal(store.build.tabs.length, 2);
  assert.equal(snapshot.build.active, fileKey('main', 'AGENTS.md'));
  assert.equal(snapshot.saved.x, 'data');
});
test('collapsed tree hides descendants, expanded tree and dotfiles are present', () => {
  const closed = treeRows(FILES, []),
    opened = treeRows(FILES, ['src']);
  assert.equal(closed.some(r => r.path === 'src/main.ts'), false);
  assert.equal(opened.some(r => r.path === 'src/main.ts'), true);
  assert.equal(closed.some(r => r.path === '.gitignore'), true);
});
test('filename search reaches unopened descendants and omits excluded dependency paths', () => {
  const list = [...FILES, {
    path: 'node_modules/target.ts'
  }, {
    path: 'src/target.ts'
  }];
  assert.deepEqual(searchFiles(list, 'target').map(r => r.path), ['src/target.ts']);
  assert.ok(searchFiles(FILES, 'rApp').some(r => r.path === 'src/renderer/App.tsx'));
});
test('no-match and Unicode queries produce deterministic results', () => {
  assert.deepEqual(searchFiles(FILES, 'not-a-file-1234'), []);
  assert.ok(searchFiles(FILES, '需求').length > 0);
});
test('directory navigation uses path segment boundaries and allows dotted directories',()=>{
  const files=[{path:'foo/a.txt'},{path:'foobar/b.txt'},{path:'foo.v1/child/file.txt'}];
  assert.deepEqual(directoryChildren(files,'foo').map(x=>x.path),['foo/a.txt']);
  assert.deepEqual(directoryChildren(files,'foo.v1'),[{path:'foo.v1/child',name:'child',folder:true}]);
});
test('tree keyboard distinguishes focus, folder expansion, and range selection',()=>{
  const rows=[{path:'src',folder:true},{path:'src/a',folder:false},{path:'src/b',folder:false}];
  assert.deepEqual(treeKeyboardIntent(rows,[],'src','ArrowRight'),{expand:'src'});
  assert.deepEqual(treeKeyboardIntent(rows,['src'],'src','ArrowRight'),{focus:'src/a'});
  assert.deepEqual(treeKeyboardIntent(rows,['src'],'src/b','ArrowLeft'),{focus:'src'});
  assert.deepEqual(treeKeyboardIntent(rows,['src'],'src/a','ArrowDown',{shift:true,anchor:'src'}),{focus:'src/b',selected:['src','src/a','src/b'],anchor:'src'});
  assert.deepEqual(treeKeyboardIntent(rows,['src'],'src/a',' ',{toggle:true,selected:['src/a']}),{selected:[],anchor:'src/a'});
});
test('filename results retain hierarchy and can collapse a compact directory',()=>{
  const files=[{path:'a/b/c/one.ts'},{path:'a/b/c/two.ts'},{path:'other/three.txt'}];
  const rows=searchTreeRows(files,'ts');assert.equal(rows[0].path,'a/b/c');assert.equal(rows[0].name,'a/b/c');assert.equal(rows[1].depth,1);
  assert.deepEqual(searchTreeRows(files,'ts',['a/b/c']).map(r=>r.path),['a/b/c']);
});
test('nested navigation roots share one physical synthetic document and migration is ambiguity-safe',()=>{
  const roots=[{id:'base',path:'/project'},{id:'nested',path:'/project/docs'}];
  const a=documentKey(roots,fileKey('base','docs/a.md')),b=documentKey(roots,fileKey('nested','a.md'));
  assert.equal(a,b);
  const old1=JSON.stringify(['local','/project','docs/a.md']),old2=JSON.stringify(['local','/project/docs','a.md']);
  assert.equal(migratePrototypeSaved({[old1]:'same',[old2]:'same'})[a],'same');
  assert.equal(migratePrototypeSaved({[old1]:'one',[old2]:'two'})[a],undefined);
});

const projectRoots = path => [{ id: 'main', hostId: 'local', path }, { id: 'extra', hostId: 'local', path: '/shared' }];
test('document identity separates projects and hosts while retaining aliases for the same root', () => {
  const route = fileKey('main', 'package.json');
  assert.notEqual(documentKey(projectRoots('/project-a'), route), documentKey(projectRoots('/project-b'), route));
  assert.notEqual(documentKey(projectRoots('/project-a'), route), documentKey([{ id: 'main', hostId: 'remote', path: '/project-a' }], route));
  assert.equal(documentKey(projectRoots('/project-a/'), route), documentKey([{ id: 'alias', path: '/project-a' }], fileKey('alias', 'package.json')));
});
test('saving the same relative path in two projects never reads or overwrites the other project', () => {
  const key = fileKey('main', 'AGENTS.md');
  let store = {
    a: editDraft(initialWorkspace(), key, 'project A content', 'base A'),
    b: editDraft(initialWorkspace(), key, 'project B content', 'base B')
  };
  store = commitDraft(store, 'a', projectRoots('/a'), key).store;
  assert.equal(store.b.drafts[key].text, 'project B content');
  assert.equal(store.saved[documentKey(projectRoots('/b'), key)], undefined);
  store = commitDraft(store, 'b', projectRoots('/b'), key).store;
  assert.equal(store.saved[documentKey(projectRoots('/a'), key)], 'project A content');
  assert.equal(store.saved[documentKey(projectRoots('/b'), key)], 'project B content');
});
test('same underlying document may share saved content but keeps task drafts independent', () => {
  const key = fileKey('main', 'AGENTS.md');
  const roots = projectRoots('/same-project');
  const a = editDraft(initialWorkspace(), key, 'save A', 'base');
  const b = editDraft(initialWorkspace(), key, 'pending B', 'base');
  const result = commitDraft({ a, b }, 'a', roots, key);
  assert.equal(result.store.saved[documentKey(roots, key)], 'save A');
  assert.equal(result.store.b.drafts[key].text, 'pending B');
  assert.equal(b.drafts[key].text, 'pending B');
});
test('conflict survives visiting another tab and persistence; ordinary save cannot clear it', () => {
  const key = fileKey('main', 'AGENTS.md');
  let state = editDraft(initialWorkspace(), key, 'local change', 'base');
  state = setFileScenario(state, key, 'conflict', 'disk change');
  state = openFile(state, 'main', 'package.json', true);
  assert.equal(fileScenario(state), 'ready');
  state = openFile(state, 'main', 'AGENTS.md', true);
  assert.equal(fileScenario(state), 'conflict');
  const store = JSON.parse(JSON.stringify(serializeWorkspaceStore({ task: state })));
  const result = commitDraft(store, 'task', projectRoots('/a'), key);
  assert.equal(result.result, 'conflict');
  assert.equal(result.store.task.drafts[key].text, 'local change');
  assert.equal(result.store.task.fileStates[key].diskText, 'disk change');
  assert.equal(result.store.saved, undefined);
});
test('saving a non-active conflict consults its own status and explicit resolution affects only that file', () => {
  const a = fileKey('main', 'AGENTS.md'), b = fileKey('main', 'package.json');
  let state = setFileScenario(editDraft(initialWorkspace(), a, 'local A', 'base A'), a, 'conflict', 'disk A');
  state = openFile(state, 'main', 'package.json', true);
  state = setFileScenario(editDraft(state, b, 'local B', 'base B'), b, 'save-error');
  const roots = projectRoots('/a');
  assert.equal(commitDraft({ task: state }, 'task', roots, a).result, 'conflict');
  const result = commitDraft({ task: state }, 'task', roots, a, { override: true });
  assert.equal(result.result, 'saved');
  assert.equal(result.store.task.drafts[a], undefined);
  assert.equal(result.store.task.drafts[b].text, 'local B');
  assert.equal(fileScenario(result.store.task, b), 'save-error');
});
test('selection handoff captures the exact UTF-16 range without editing the source', () => {
  const text = '😀 workspace / workspace';
  const start = text.lastIndexOf('workspace');
  const context = { scope: 'task-a', identity: 'file-a', revision: 4, text };
  const selection = captureSelection({ ...context, start, end: start + 'workspace'.length });
  assert.equal(selection.text, 'workspace');
  assert.equal(selection.start, text.lastIndexOf('workspace'));
  assert.equal(selectionIsCurrent(selection, context), true);
  assert.equal(context.text, text);
});
test('selection handoff rejects stale file, task, revision, or changed source', () => {
  const context = { scope: 'task-a', identity: 'file-a', revision: 4, text: 'same text' };
  const selection = captureSelection({ ...context, start: 0, end: 4 });
  for (const changed of [{ scope: 'task-b' }, { identity: 'file-b' }, { revision: 5 }, { text: 'same text changed' }]) {
    assert.equal(selectionIsCurrent(selection, { ...context, ...changed }), false);
  }
  assert.equal(captureSelection({ ...context, start: 0, end: 0 }), null);
});
test('adopting disk invalidates the viewer instance and old selection without discarding another draft', () => {
  const a = fileKey('main', 'AGENTS.md'), b = fileKey('main', 'docs/数据.xlsx');
  let state = editDraft(initialWorkspace(), a, 'keep this', 'base A');
  state = openFile(state, 'main', 'docs/数据.xlsx', true);
  state = setFileScenario(editDraft(state, b, 'local workbook', 'base B'), b, 'conflict', 'disk workbook');
  const next = acceptDisk(state, b);
  assert.equal(next.drafts[b], undefined);
  assert.equal(next.drafts[a].text, 'keep this');
  assert.equal(next.revisions[b], state.revisions[b] + 1);
  assert.equal(next.reloads[b], 1);
  assert.equal(fileScenario(next, b), 'ready');
  assert.equal(state.drafts[b].text, 'local workbook');
});
test('slide edits survive serialization on their own page and preserve other slides/comments', () => {
  const initial = artifactModel();
  const edited = updateArtifactSlide(initial, 1, 'Updated second slide');
  const restored = artifactModel(JSON.stringify({ ...edited, comments: ['keep comment'] }));
  assert.equal(restored.slides[1].title, 'Updated second slide');
  assert.equal(restored.slides[0].title, initial.slides[0].title);
  assert.equal(restored.slides[2].title, initial.slides[2].title);
  assert.deepEqual(restored.comments, ['keep comment']);
  assert.equal(initial.slides[1].title, '每一项需求都有依据');
});
test('workbook edits are isolated per sheet and an explicit disk reload uses the new model', () => {
  const initial = artifactModel();
  const local = updateArtifactCell(initial, 1, 1, 1, 'Sheet two edit');
  const restored = artifactModel(JSON.stringify(local));
  assert.equal(restored.sheets[1].cells[1][1], 'Sheet two edit');
  assert.equal(restored.sheets[0].cells[1][1], initial.sheets[0].cells[1][1]);
  const disk = artifactModel(JSON.stringify(updateArtifactCell(initial, 0, 1, 1, 'Disk version')));
  const nextLocal = updateArtifactCell(disk, 1, 2, 1, 'After reload edit');
  assert.equal(nextLocal.sheets[0].cells[1][1], 'Disk version');
  assert.notEqual(nextLocal.sheets[1].cells[1][1], 'Sheet two edit');
});

test('another task saving the same document makes a stale draft conflict instead of overwriting', () => {
  const key = fileKey('main', 'AGENTS.md');
  const roots = projectRoots('/same-project');
  const a = editDraft(initialWorkspace(), key, 'saved by A', 'base');
  const b = editDraft(initialWorkspace(), key, 'pending B', 'base');
  const first = commitDraft({ a, b }, 'a', roots, key);
  const second = commitDraft(first.store, 'b', roots, key);
  assert.equal(second.result, 'conflict');
  assert.equal(second.store.saved[documentKey(roots, key)], 'saved by A');
  assert.equal(second.store.b.drafts[key].text, 'pending B');
  assert.equal(second.store.b.fileStates[key].diskText, 'saved by A');
});

test('changing a task root cannot rebind its old draft aliases to another project', () => {
  const key = fileKey('main', 'AGENTS.md');
  const oldScope = workspaceScope('task-a', projectRoots('/old'));
  const newScope = workspaceScope('task-a', projectRoots('/new'));
  const stored = { [oldScope]: editDraft(initialWorkspace(), key, 'old root draft', 'base') };
  assert.notEqual(oldScope, newScope);
  assert.equal(stored[newScope], undefined);
  assert.equal(stored[oldScope].drafts[key].text, 'old root draft');
  assert.equal(workspaceScope('task-a', projectRoots('/old/')), oldScope);
});

import { treeKeyboardIntent as _intent, treeSetInfo as _setInfo } from '../src/file-workspace-model.mjs';
import { composing as _composing } from '../src/file-ime.mjs';
import _test from 'node:test';
import _assert from 'node:assert/strict';
const _rows = [{ path: 'docs', folder: true }, { path: 'docs/a.md' }, { path: 'docs/b.md' }, { path: 'x.txt' }];
_test('Shift+arrow without an anchor starts at the focused row, not the first row', () => {
  const r = _intent(_rows, ['docs'], 'docs/a.md', 'ArrowDown', { shift: true, anchor: null });
  _assert.deepEqual(r.selected, ['docs/a.md', 'docs/b.md']); _assert.equal(r.anchor, 'docs/a.md');
  const stale = _intent(_rows, ['docs'], 'docs/a.md', 'ArrowDown', { shift: true, anchor: 'removed/gone.md' });
  _assert.deepEqual(stale.selected, ['docs/a.md', 'docs/b.md']);
});
_test('Shift+arrow keeps a valid anchor when extending in both directions', () => {
  const up = _intent(_rows, ['docs'], 'docs/b.md', 'ArrowUp', { shift: true, anchor: 'x.txt' });
  _assert.equal(up.focus, 'docs/a.md'); _assert.deepEqual(up.selected, ['docs/a.md', 'docs/b.md', 'x.txt']); _assert.equal(up.anchor, 'x.txt');
});
_test('tree set info counts siblings per parent over the visible rows', () => {
  const info = _setInfo(_rows);
  _assert.deepEqual(info['docs'], { pos: 1, size: 2 }); _assert.deepEqual(info['x.txt'], { pos: 2, size: 2 });
  _assert.deepEqual(info['docs/a.md'], { pos: 1, size: 2 }); _assert.deepEqual(info['docs/b.md'], { pos: 2, size: 2 });
  _assert.deepEqual(_setInfo([]), {});
});
_test('IME composition is detected from the native event, keyCode 229, or the synthetic flag', () => {
  _assert.equal(_composing({ nativeEvent: { isComposing: true } }), true); _assert.equal(_composing({ keyCode: 229 }), true);
  _assert.equal(_composing({ isComposing: true }), true); _assert.equal(_composing({ nativeEvent: { isComposing: false }, keyCode: 13 }), false);
  _assert.equal(_composing(null), false); _assert.equal(_composing({}), false);
});


test('external update refreshes a clean file and remains latest after reopening, with no request state', () => {
  const state=initialWorkspace(), key=state.active, roots=projectRoots('/a'), id=documentKey(roots,key);
  const next=applyExternalFileChange({task:state},'task',roots,key,'new disk');
  assert.equal(next.saved[id],'new disk'); assert.equal(fileScenario(next.task,key),'ready');
  assert.equal(next.task.drafts[key],undefined); assert.equal(next.task.revisions[key],1);
  const reopened=openFile(closeFile(next.task,key),'main','AGENTS.md',true);
  assert.equal(next.saved[documentKey(roots,reopened.active)],'new disk');
});
test('external update protects a manual draft; ordinary conflict actions choose disk or local', () => {
  const base=initialWorkspace(), key=base.active, roots=projectRoots('/a'), id=documentKey(roots,key);
  const state=editDraft(base,key,'manual edit','old disk');
  const next=applyExternalFileChange({task:state},'task',roots,key,'external edit');
  assert.equal(next.task.drafts[key].text,'manual edit'); assert.equal(next.task.drafts[key].base,'old disk');
  assert.equal(fileScenario(next.task,key),'conflict'); assert.equal(commitDraft(next,'task',roots,key).result,'conflict');
  assert.equal(acceptDisk(next.task,key).drafts[key],undefined); assert.equal(next.saved[id],'external edit');
  const kept=commitDraft(next,'task',roots,key,{override:true}); assert.equal(kept.store.saved[id],'manual edit');
});
test('external update matching the draft becomes clean, matching its base preserves draft without conflict', () => {
  const base=initialWorkspace(), key=base.active, roots=projectRoots('/a'), state=editDraft(base,key,'manual edit','old disk');
  const matched=applyExternalFileChange({task:state},'task',roots,key,'manual edit');
  assert.equal(matched.task.drafts[key],undefined); assert.equal(fileScenario(matched.task,key),'ready');
  const unchanged=applyExternalFileChange({task:state},'task',roots,key,'old disk');
  assert.equal(unchanged.task.drafts[key].text,'manual edit'); assert.equal(fileScenario(unchanged.task,key),'ready');
});
test('external update cannot overwrite another file draft or cross the root identity', () => {
  const roots=projectRoots('/a'), base=openFile(initialWorkspace(),'main','src/main.ts',true), key=base.active, other=fileKey('main','AGENTS.md');
  const state=editDraft(base,other,'keep me','old'); const next=applyExternalFileChange({task:state},'task',roots,key,'new code');
  assert.equal(next.task.drafts[other].text,'keep me'); assert.equal(next.saved[documentKey(roots,other)],undefined);
  assert.equal(applyExternalFileChange(next,'task',roots,fileKey('missing','a'),'bad'),next);
});
test('synthetic external file appears only after directory refresh and stays scoped to its root', () => {
  const file={path:'external.md',kind:'markdown',text:'new'}, pending=queueSyntheticFile(initialWorkspace(),'main',file);
  assert.equal(pending.syntheticFiles?.main,undefined); assert.deepEqual(pending.pendingFiles.main,[file]);
  const other=refreshSyntheticDirectory(pending,'extra'); assert.equal(other.syntheticFiles.main,undefined);
  const refreshed=refreshSyntheticDirectory(other,'main'); assert.deepEqual(refreshed.syntheticFiles.main,[file]); assert.deepEqual(refreshed.pendingFiles.main,[]);
  const again=refreshSyntheticDirectory(queueSyntheticFile(refreshed,'main',{...file,text:'latest'}),'main');
  assert.equal(again.syntheticFiles.main.length,1); assert.equal(again.syntheticFiles.main[0].text,'latest');
});
