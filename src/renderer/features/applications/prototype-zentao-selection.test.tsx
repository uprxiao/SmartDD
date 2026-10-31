// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared prototype source is JavaScript.
import {ProjectApplications} from '@root/prototypes/m6-codex/src/IntegrationPackageUI.jsx';
// @ts-expect-error Shared prototype model is JavaScript.
import {initialIntegrationState,projectIntegrationState,integrationSnapshot} from '@root/prototypes/m6-codex/src/integration-model.mjs';
const showModal=HTMLDialogElement.prototype.showModal,close=HTMLDialogElement.prototype.close;
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(()=>{cleanup();HTMLDialogElement.prototype.showModal=showModal;HTMLDialogElement.prototype.close=close;});
const base=()=>projectIntegrationState(initialIntegrationState());
function mount({data=base(),archived=false,tasks=[] as Record<string,unknown>[]}={}){
 let current=data;const stop=vi.fn(),change=vi.fn();
 function Harness(){const [value,setValue]=useState(data);current=value;return <ProjectApplications project={{id:'ais',name:'AIS',archived}} integration={{data:value,setData:(next:unknown)=>{change(next);setValue(next as never);},storageFailed:false}} nav={vi.fn()} onUse={vi.fn()} tasks={tasks} onStopTasks={stop}/>;}
 const view=render(<Harness/>);return{view,stop,change,get:()=>current};
}
const none=()=>screen.getByRole('radio',{name:'禅道连接不选用'}) as HTMLInputElement;
const original=()=>screen.getByRole('radio',{name:'为ais选用公司禅道'}) as HTMLInputElement;
it('PP exposes explicit no-selection and cancellation preserves the selected source and all data',()=>{
 const data=base(),before=JSON.stringify(data),ctx=mount({data});expect(none().checked).toBe(false);fireEvent.click(none());expect(original().checked).toBe(true);expect(none().checked).toBe(false);expect(screen.getByRole('dialog').textContent).toContain('公司禅道 → 不选用');fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(screen.queryByRole('dialog')).toBeNull();expect(JSON.stringify(ctx.get())).toBe(before);expect(ctx.stop).not.toHaveBeenCalled();expect(ctx.change).not.toHaveBeenCalled();
});
it('PP clears only this project ZenTao binding,keeps enablement/Mail/other project,and explicitly reselects without an old-source dialog',()=>{
 const ctx=mount(),before=structuredClone(ctx.get());fireEvent.click(none());fireEvent.click(screen.getByRole('button',{name:'切换连接 · 模拟'}));expect(none().checked).toBe(true);expect(original().checked).toBe(false);expect(ctx.get().bindings.ais).toEqual(['fox-demo']);expect(ctx.get().bindings.smartdd).toEqual(before.bindings.smartdd);expect(ctx.get().projectApps).toEqual(before.projectApps);expect(ctx.get().connections).toEqual(before.connections);fireEvent.click(original());expect(screen.queryByRole('dialog')).toBeNull();expect(original().checked).toBe(true);expect(none().checked).toBe(false);expect(new Set(ctx.get().bindings.ais)).toEqual(new Set(before.bindings.ais));
});
it('PP renders no-selection for an empty connection list while retaining enabled application and other project data',()=>{
 const data=base();data.connections=data.connections.filter((c:{app:string})=>c.app!=='zentao');data.bindings.ais=['fox-demo'];data.bindings.smartdd=[];const ctx=mount({data});expect(none().checked).toBe(true);expect(ctx.get().projectApps.ais.zentao).toBe(true);expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['archived','unadded'])('PP disables no-selection when %s',state=>{
 const data=base();if(state==='unadded')data.installed=['mail'];const ctx=mount({data,archived:state==='archived'});expect(none().disabled).toBe(true);fireEvent.click(none());expect(ctx.change).not.toHaveBeenCalled();expect(ctx.stop).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['stop','commit'])('PP preserves the original source after simulated %s failure and stops only related runs',failure=>{
 const data=base(),snapshot=integrationSnapshot(data,'ais'),tasks=[{id:'own-zen',project:'ais',status:'running',integrationSnapshot:snapshot},{id:'other-project',project:'smartdd',status:'running',integrationSnapshot:integrationSnapshot(data,'smartdd')},{id:'own-mail',project:'ais',status:'running',integrationSnapshot:{...snapshot,packages:snapshot.packages.filter((p:{id:string})=>p.id==='mail')}}];const ctx=mount({data,tasks}),before=JSON.stringify(ctx.get());fireEvent.click(none());const dialog=screen.getByRole('dialog');expect(dialog.textContent).not.toContain('other-project');fireEvent.change(within(dialog).getByRole('combobox'),{target:{value:failure}});fireEvent.click(within(dialog).getByRole('button',{name:'停止相关运行并切换 · 模拟'}));expect(original().checked).toBe(true);expect(JSON.stringify(ctx.get())).toBe(before);expect(ctx.change).not.toHaveBeenCalled();if(failure==='stop')expect(ctx.stop).not.toHaveBeenCalled();else expect(ctx.stop).toHaveBeenCalledExactlyOnceWith(['own-zen']);
});
it('PP clicking the already selected source submits nothing and opens no dialog',()=>{const ctx=mount(),before=JSON.stringify(ctx.get());fireEvent.click(original());expect(screen.queryByRole('dialog')).toBeNull();expect(ctx.change).not.toHaveBeenCalled();expect(ctx.stop).not.toHaveBeenCalled();expect(JSON.stringify(ctx.get())).toBe(before);});
it('PP preserves an unknown active scope and disables confirmation even with no current binding',()=>{const data=base();data.bindings.ais=['fox-demo'];const ctx=mount({data,tasks:[{id:'unknown',project:'ais',status:'running',integrationScopeUnknown:true}]});fireEvent.click(original());expect(screen.getByRole('alert').textContent).toContain('无法核验');expect(screen.getByRole('button',{name:'切换连接 · 模拟'})).toHaveProperty('disabled',true);expect(ctx.change).not.toHaveBeenCalled();expect(ctx.stop).not.toHaveBeenCalled();expect(none().checked).toBe(true);});
it('PT keeps inside clicks open and dismisses only a backdrop click without changing the selected connection',()=>{const ctx=mount(),before=JSON.stringify(ctx.get());fireEvent.click(none());const d=screen.getByRole('dialog');fireEvent.click(d.querySelector('.m10-modal-copy')!);expect(screen.getByRole('dialog')).toBe(d);fireEvent.click(d);expect(screen.queryByRole('dialog')).toBeNull();expect(JSON.stringify(ctx.get())).toBe(before);expect(ctx.change).not.toHaveBeenCalled();expect(ctx.stop).not.toHaveBeenCalled();});
it('PT exposes the same vector close control as the packaged dialog and cancellation leaves selection intact',()=>{const ctx=mount(),before=JSON.stringify(ctx.get());fireEvent.click(none());const close=within(screen.getByRole('dialog')).getByRole('button',{name:'关闭弹窗'});expect(close.querySelector('svg.lucide-x')).not.toBeNull();expect(close.querySelector('svg')?.getAttribute('width')).toBe('17');fireEvent.click(close);expect(screen.queryByRole('dialog')).toBeNull();expect(JSON.stringify(ctx.get())).toBe(before);expect(ctx.change).not.toHaveBeenCalled();});
it('PU does not discard a pending selection review when clicking root padding inside the dialog border',()=>{const ctx=mount(),before=JSON.stringify(ctx.get());fireEvent.click(none());const d=screen.getByRole('dialog');vi.spyOn(d,'getBoundingClientRect').mockReturnValue({x:100,y:80,left:100,top:80,right:500,bottom:380,width:400,height:300,toJSON:()=>({})});fireEvent.click(d,{clientX:104,clientY:230});expect(screen.queryByRole('dialog')).toBe(d);expect(JSON.stringify(ctx.get())).toBe(before);expect(ctx.change).not.toHaveBeenCalled();expect(ctx.stop).not.toHaveBeenCalled();fireEvent.click(d,{clientX:8,clientY:8});expect(screen.queryByRole('dialog')).toBeNull();expect(ctx.change).not.toHaveBeenCalled();});
