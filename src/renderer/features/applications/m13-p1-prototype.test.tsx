// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared synthetic prototype is JavaScript.
import {P1WritePreview,P1MigrationNotice} from '@root/prototypes/m6-codex/src/M13P1States.jsx';
// @ts-expect-error Shared synthetic prototype is JavaScript.
import {M13Workspace,useM13State} from '@root/prototypes/m6-codex/src/M13Workspace.jsx';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('P1 synthetic write review does not steal focus or approve from terminal Enter; only the explicit decision changes the view',()=>{
 const input=document.createElement('textarea');document.body.append(input);input.focus();render(<P1WritePreview scene="p1-write-pending"/>);expect(document.activeElement).toBe(input);
 expect(screen.getByRole('dialog',{name:'确认本次插件写操作'})).toBeTruthy();expect(screen.getByText(/synthetic-account-one/)).toBeTruthy();fireEvent.keyDown(screen.getByRole('textbox',{name:'模拟终端输入'}),{key:'Enter'});expect(screen.queryByRole('status')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'允许这一次'}));expect(screen.getByRole('status').textContent).toContain('仅记录一次合成决定');expect(screen.queryByRole('dialog')).toBeNull();input.remove();
});
it('P1 Escape rejects only the displayed synthetic write request',()=>{
 render(<P1WritePreview scene="p1-write-pending"/>);fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.getByRole('status').textContent).toContain('已拒绝（演示）');expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['expired','stale','busy'])('P1 synthetic %s request cannot be approved',state=>{
 render(<P1WritePreview scene={'p1-write-'+state}/>);const button=screen.getByRole('button',{name:state==='busy'?'正在处理…':'允许这一次'});expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(button);expect(screen.queryByRole('status')).toBeNull();
});
it('P1 unknown result offers no automatic resend and channel failure retries only the synthetic review view',()=>{
 const view=render(<P1WritePreview scene="p1-write-unknown"/>);expect(screen.getByRole('alert').textContent).toContain('不要重复提交');expect(screen.queryAllByRole('button')).toHaveLength(0);view.unmount();render(<P1WritePreview scene="p1-write-channel-error"/>);expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.queryByRole('status')).toBeNull();
});
it.each([['failed','仍保留原内置功能和数据'],['uncertain','请重新启动后核对']])('P1 migration %s notice preserves the recovery boundary', (state,text)=>{
 render(<P1MigrationNotice scene={'p1-migration-'+state}/>);expect(screen.getByRole('alert').textContent).toContain(text);expect(screen.queryAllByRole('button')).toHaveLength(0);
});
it('P1 migration fallback keeps Zentao under builtins and never presents it as an already migrated external plugin',()=>{
 function Fixture(){const store=useM13State(),[route,nav]=useState('m13/plugins');return <M13Workspace store={store} route={route} nav={nav} projects={[]} tasks={[]} dark={false} onTheme={()=>{}} onTryPrompt={()=>{}}/>;}
 render(<Fixture/>);fireEvent.change(screen.getByRole('combobox'),{target:{value:'p1-migration-failed'}});const builtin=Array.from(document.querySelectorAll('.m13-group')).find(el=>el.querySelector('h2')?.textContent?.includes('内置'));expect(builtin?.textContent).toContain('禅道');const external=Array.from(document.querySelectorAll('.m13-group')).find(el=>el.querySelector('h2')?.textContent?.includes('外部插件'));expect(external?.textContent??'').not.toContain('禅道');
});
it('P1 missing default remains empty until a specific connection and impact confirmation are chosen',()=>{
 const snapshots:{defaults:unknown;bindings:unknown}[]=[];
 function Fixture(){const store=useM13State(),[route,nav]=useState('m13/plugins');snapshots.push({defaults:structuredClone(store.defaults),bindings:structuredClone(store.bindings)});return <M13Workspace store={store} route={route} nav={nav} projects={[{id:'ais',name:'合成 AIS'},{id:'daily',name:'合成日常'}]} tasks={[]} dark={false} onTheme={()=>{}} onTryPrompt={()=>{}}/>;}
 render(<Fixture/>);const before=snapshots.at(-1)!.bindings;fireEvent.change(screen.getByRole('combobox'),{target:{value:'p1-default-missing'}});expect(screen.getByRole('alert').textContent).toContain('请选择一个全局默认连接');expect((snapshots.at(-1)!.defaults as {zentao:{zentao:string|null}}).zentao.zentao).toBeNull();expect(snapshots.at(-1)!.bindings).toEqual(before);
 const more=screen.getAllByRole('button').find(b=>b.getAttribute('aria-label')?.endsWith(' 更多操作'));expect(more).toBeTruthy();fireEvent.click(more!);fireEvent.click(screen.getByRole('menuitem',{name:'设为全局默认'}));const dialog=screen.getByRole('dialog',{name:'更换全局默认连接'});expect(dialog.textContent).toContain('保持不变的项目');expect((snapshots.at(-1)!.defaults as {zentao:{zentao:string|null}}).zentao.zentao).toBeNull();fireEvent.click(within(dialog).getByRole('button',{name:'确认更换'}));expect(screen.queryByRole('alert')).toBeNull();expect((snapshots.at(-1)!.defaults as {zentao:{zentao:string|null}}).zentao.zentao).toBeTruthy();expect(snapshots.at(-1)!.bindings).toEqual(before);
});
