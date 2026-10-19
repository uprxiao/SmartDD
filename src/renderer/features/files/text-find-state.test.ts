import{Compartment,EditorState}from'@codemirror/state';
import{history,undoDepth}from'@codemirror/commands';
import{describe,expect,it}from'vitest';
import{fileFindCurrent,fileFindQuery,fileFindState}from'./text-find-state';
describe('current-file Find bounded transaction state',()=>{
 it.each([998,999,1000])('uses the1000th actual match only as a sentinel for %i matches',total=>{
  const doc='😀İ word\r\n'.repeat(total);let state=EditorState.create({doc,extensions:[history(),fileFindState]});state=state.update({effects:fileFindQuery.of('word')}).state;const result=state.field(fileFindState);expect(result.matches).toHaveLength(Math.min(total,999));expect(result.limited).toBe(total>999);for(const m of result.matches)expect(state.sliceDoc(m.from,m.to)).toBe('word');expect(state.doc.toString()).toBe(doc.replace(/\r\n/g,'\n'));expect(undoDepth(state)).toBe(0);
 });
 it('clamps the current result after actual edits, keeps the caret and clears more as the last extra match is removed',()=>{
  let state=EditorState.create({doc:'word\n'.repeat(1000),extensions:[fileFindState]});state=state.update({effects:[fileFindQuery.of('word'),fileFindCurrent.of(998)]}).state;state=state.update({changes:{from:4995,to:5000},selection:{anchor:4995}}).state;expect(state.field(fileFindState)).toMatchObject({current:998,limited:false});expect(state.selection.main.head).toBe(4995);state=state.update({changes:{from:0,to:state.doc.length,insert:'😀word'},selection:{anchor:0}}).state;expect(state.field(fileFindState)).toMatchObject({current:0,matches:[{from:2,to:6}],limited:false});expect(state.selection.main.head).toBe(0);
 });
 it('query changes reset only their own current match, and closing clears their highlights without changing source or history',()=>{
  let state=EditorState.create({doc:'BASE base literal.*',extensions:[history(),fileFindState]});state=state.update({effects:[fileFindQuery.of('base'),fileFindCurrent.of(1)]}).state;expect(state.field(fileFindState).current).toBe(1);state=state.update({effects:fileFindQuery.of('.*')}).state;expect(state.field(fileFindState)).toMatchObject({query:'.*',current:0,matches:[{from:17,to:19}]});state=state.update({effects:fileFindQuery.of('')}).state;expect(state.field(fileFindState)).toMatchObject({query:'',current:0,matches:[],limited:false});expect(state.doc.toString()).toBe('BASE base literal.*');expect(undoDepth(state)).toBe(0);
 });
 it('retains query/current across an unrelated view compartment reconfiguration and keeps a second document independent',()=>{
  const config=new Compartment();let first=EditorState.create({doc:'word word',extensions:config.of([fileFindState])}),second=EditorState.create({doc:'other',extensions:[fileFindState]});first=first.update({effects:[fileFindQuery.of('word'),fileFindCurrent.of(1)]}).state;first=first.update({effects:config.reconfigure([fileFindState,EditorState.readOnly.of(true)])}).state;expect(first.field(fileFindState)).toMatchObject({query:'word',current:1});expect(second.field(fileFindState)).toMatchObject({query:'',matches:[]});
 });
});
