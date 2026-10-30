// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared synthetic prototype is JavaScript.
import {IntegrationWorkspace} from '@root/prototypes/m6-codex/src/IntegrationWorkspace.jsx';
// @ts-expect-error Shared synthetic model is JavaScript.
import {initialIntegrationState} from '@root/prototypes/m6-codex/src/integration-model.mjs';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('ST Tab exits the open catalog menu without adding an application or navigating',()=>{
 const h=mount(),before=JSON.stringify(h.data);fireEvent.click(h.add);
 const menu=screen.getByRole('menu'),first=screen.getAllByRole('menuitem')[0];
 expect(menu).toBeTruthy();expect(document.activeElement).toBe(first);
 fireEvent.keyDown(first,{key:'Tab',code:'Tab'});
 expect(screen.queryByRole('menu')).toBeNull();
 expect(h.setData).not.toHaveBeenCalled();expect(h.nav).not.toHaveBeenCalled();expect(JSON.stringify(h.data)).toBe(before);
});
function mount(route="apps"){
 const data=initialIntegrationState(),setData=vi.fn(),nav=vi.fn();
 render(<IntegrationWorkspace route={route} projects={[{id:'ais',name:'本次项目'}]} tasks={[]} selectedProjectId="ais" onSelectProject={vi.fn()} integration={{data,setData,storageFailed:false}} nav={nav} onUsePrompt={vi.fn()} onNewProjectTask={vi.fn()} dark={false} onTheme={vi.fn()}/>);
 return{data,setData,nav,refresh:screen.queryByRole('button',{name:'刷新应用'})as HTMLButtonElement,add:screen.queryByRole('button',{name:'添加'})as HTMLButtonElement};
}
it('QO blocks repeated refresh while loading and restores controls after the one pending refresh',()=>{
 vi.useFakeTimers();const h=mount(),before=JSON.stringify(h.data);expect(h.refresh.disabled).toBe(false);
 fireEvent.click(h.refresh);expect(screen.getByText('正在加载应用')).toBeTruthy();expect(h.refresh.disabled).toBe(true);expect(h.add.disabled).toBe(true);
 fireEvent.click(h.refresh);act(()=>vi.advanceTimersByTime(419));expect(screen.getByText('正在加载应用')).toBeTruthy();
 act(()=>vi.advanceTimersByTime(1));expect(h.refresh.disabled).toBe(false);expect(h.add.disabled).toBe(false);expect(screen.queryByText('正在加载应用')).toBeNull();expect(h.setData).not.toHaveBeenCalled();expect(h.nav).not.toHaveBeenCalled();expect(JSON.stringify(h.data)).toBe(before);
 fireEvent.change(screen.getByRole('combobox',{name:'M10演示场景'}),{target:{value:'loading'}});expect(h.refresh.disabled).toBe(true);expect(h.add.disabled).toBe(true);
});
it.each(['error','empty'])('QO keeps %s retry available while adding remains unavailable',scene=>{
 vi.useFakeTimers();const h=mount();fireEvent.change(screen.getByRole('combobox',{name:'M10演示场景'}),{target:{value:scene}});expect(h.refresh.disabled).toBe(false);expect(h.add.disabled).toBe(true);
 if(scene==='error'){
  fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(h.refresh.disabled).toBe(true);act(()=>vi.advanceTimersByTime(420));expect(h.refresh.disabled).toBe(false);expect(h.add.disabled).toBe(false);expect(screen.queryByText('应用暂时无法加载')).toBeNull();expect(h.setData).not.toHaveBeenCalled();
 }
});

it.each([['apps/zentao','应用更多操作'],['apps/zentao','管理公司禅道'],['apps/mail','添加连接']])('SW Tab exits %s / %s without an action', (route,label)=>{
 const h=mount(route),before=JSON.stringify(h.data),trigger=screen.getByRole('button',{name:label});trigger.focus();fireEvent.click(trigger);
 const first=screen.getAllByRole('menuitem')[0];expect(document.activeElement).toBe(first);
 fireEvent.keyDown(first,{key:'Tab',code:'Tab'});
 expect(screen.queryByRole('menu')).toBeNull();expect(h.setData).not.toHaveBeenCalled();expect(h.nav).not.toHaveBeenCalled();expect(JSON.stringify(h.data)).toBe(before);
});
it.each([['应用更多操作','移除应用'],['管理公司禅道','断开连接']])('SW cancel %s / %s restores its persistent trigger', (label,action)=>{
 const proto=HTMLDialogElement.prototype,show=Object.getOwnPropertyDescriptor(proto,'showModal'),close=Object.getOwnPropertyDescriptor(proto,'close');
 Object.defineProperty(proto,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 Object.defineProperty(proto,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 try{
  const h=mount('apps/zentao'),trigger=screen.getByRole('button',{name:label});trigger.focus();fireEvent.click(trigger);
  const item=screen.getByRole('menuitem',{name:action});item.focus();fireEvent.click(item);
  expect(screen.getByRole('dialog',{name:action})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(h.setData).not.toHaveBeenCalled();expect(h.nav).not.toHaveBeenCalled();
 }finally{if(show)Object.defineProperty(proto,'showModal',show);else delete (proto as any).showModal;if(close)Object.defineProperty(proto,'close',close);else delete (proto as any).close;}
});
