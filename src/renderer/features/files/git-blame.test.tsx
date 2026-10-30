// @vitest-environment jsdom
import {EditorState}from'@codemirror/state';
import {EditorView}from'@codemirror/view';
import {afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import {gitBlameExtension,BlameCard}from'./git-blame';
import {cleanup,fireEvent,render}from'@testing-library/react';
import type{FileBuffer}from'./file-buffer';
const api=vi.hoisted(()=>({gitBlame:vi.fn(),cancelGit:vi.fn(async()=>undefined)}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const result=(author='First Author')=>({state:'ready',baseHash:'a'.repeat(64),repository:{id:'fixture',head:'f'.repeat(40),webBase:null,prefix:''},lines:[{line:1,commitId:'f'.repeat(40),author,at:1,summary:author}]});
const pending=()=>{let finish!:(v:ReturnType<typeof result>)=>void;const promise=new Promise<ReturnType<typeof result>>(r=>finish=r);return{promise,finish};};
const views:EditorView[]=[];
const titles=()=>[...document.querySelectorAll('.fw-blame-author')].map(x=>x.textContent);
function fixture(){const status=vi.fn(),select=vi.fn(),buffer={dirty:false,saving:false,conflict:false,version:0,file:{ref:{id:'fixture'},revision:{hash:'a'.repeat(64)}}}as unknown as FileBuffer,host=document.createElement('div');document.body.append(host);const view=new EditorView({parent:host,state:EditorState.create({doc:'source first\nsource second\n',extensions:gitBlameExtension(buffer,status,select)})});views.push(view);return{view,buffer,status,select};}
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();api.gitBlame.mockResolvedValue(result());vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});});
afterEach(()=>{cleanup();for(const v of views.splice(0))v.destroy();document.body.replaceChildren();vi.useRealTimers();vi.unstubAllGlobals();});
describe('S05 real CodeMirror blame state, controlled unit RPC only',()=>{
 it('clears line markers on a real document edit and stops attribution while dirty',async()=>{const f=fixture();await vi.advanceTimersByTimeAsync(220);expect(titles()).toContain('First Author');const count=api.gitBlame.mock.calls.length;Object.defineProperty(f.buffer,'dirty',{value:true,writable:true});f.buffer.version++;f.view.dispatch({changes:{from:0,to:6,insert:'edited'}});expect(titles()).toEqual([]);await vi.advanceTimersByTimeAsync(220);expect(api.gitBlame).toHaveBeenCalledTimes(count);expect(f.status).toHaveBeenLastCalledWith('文件有未保存或冲突内容，行归属暂不可用。');expect(f.select).toHaveBeenCalledWith(null);});
 it('discards old attribution after a newer clean document receives its own result',async()=>{const old=pending();api.gitBlame.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('Current Author'));const f=fixture();await vi.advanceTimersByTimeAsync(220);const id=api.gitBlame.mock.calls[0][0].id;f.buffer.file.revision.hash='b'.repeat(64);f.buffer.version++;f.view.dispatch({changes:{from:0,to:6,insert:'newest'}});await vi.advanceTimersByTimeAsync(220);expect(api.cancelGit).toHaveBeenCalledWith(id);expect(titles()).toContain('Current Author');old.finish(result('Stale Author'));await vi.advanceTimersByTimeAsync(0);expect(titles()).toEqual(['Current Author']);expect(f.view.state.doc.toString()).toBe('newest first\nsource second\n');});
 it('shows unavailable attribution without retaining markers from the prior document',async()=>{const f=fixture();await vi.advanceTimersByTimeAsync(220);api.gitBlame.mockResolvedValueOnce({state:'unavailable',reason:'No current source'});f.buffer.file.revision.hash='c'.repeat(64);f.buffer.version++;f.view.dispatch({changes:{from:0,to:6,insert:'latest'}});await vi.advanceTimersByTimeAsync(220);expect(titles()).toEqual([]);expect(f.status).toHaveBeenLastCalledWith('No current source');});
 it('cancels and clears selection on view destruction, ignoring an original pending callback',async()=>{const work=pending();api.gitBlame.mockReturnValueOnce(work.promise);const f=fixture();await vi.advanceTimersByTimeAsync(220);const id=api.gitBlame.mock.calls[0][0].id;f.view.destroy();views.splice(views.indexOf(f.view),1);expect(api.cancelGit).toHaveBeenCalledWith(id);expect(f.select).toHaveBeenLastCalledWith(null);const calls=f.status.mock.calls.length;work.finish(result('Destroyed Author'));await vi.advanceTimersByTimeAsync(0);expect(f.status).toHaveBeenCalledTimes(calls);});
});

describe('S05 attribution card scroll and unmount lifecycle',()=>{
 const selection=()=>({line:result().lines[0],repository:result().repository,anchor:new DOMRect(20,20,100,20),pinned:true});
 it('closes on an actual nonbubbling ancestor scroll even when the editor viewport range stays cached',()=>{const source=document.createElement('div');document.body.append(source);const onClose=vi.fn();render(<BlameCard selection={selection()} onClose={onClose}/>);fireEvent.scroll(source);expect(onClose).toHaveBeenCalledTimes(1);});
 it('removes scroll, resize and Escape callbacks when the card unmounts',()=>{const source=document.createElement('div');document.body.append(source);const onClose=vi.fn(),mounted=render(<BlameCard selection={selection()} onClose={onClose}/>);fireEvent.scroll(source);expect(onClose).toHaveBeenCalledTimes(1);onClose.mockClear();mounted.unmount();fireEvent.scroll(source);fireEvent.resize(window);fireEvent.keyDown(window,{key:'Escape'});expect(onClose).not.toHaveBeenCalled();});
});
