// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared synthetic prototype is JavaScript.
import {IntegrationWorkspace} from '@root/prototypes/m6-codex/src/IntegrationWorkspace.jsx';
// @ts-expect-error Shared synthetic model is JavaScript.
import {initialIntegrationState,projectIntegrationState} from '@root/prototypes/m6-codex/src/integration-model.mjs';
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:()=>{}});});
afterEach(()=>{cleanup();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');});
it('shows the optional HTML safe-text state as a synthetic preview without changing saved business data',async()=>{
 const data=projectIntegrationState(initialIntegrationState());data.drafts=[{id:'oq-html-demo',project:'ais',fixture:'m10-review',revision:1,senderId:'',status:'draft',at:'本次合成'}];
 const before=JSON.stringify(data),setData=vi.fn(),props={projects:[{id:'ais',name:'AIS'}],tasks:[],selectedProjectId:'ais',onSelectProject:vi.fn(),integration:{data,setData,storageFailed:false},nav:vi.fn(),onUsePrompt:vi.fn(),dark:false,onTheme:vi.fn()};
 const {container}=render(<IntegrationWorkspace {...props} route="apps/mail"/>);const row=container.querySelector('.m10-draft-row')!;expect(row).toBeTruthy();fireEvent.click(row);await waitFor(()=>expect(container.querySelector('dialog .m10-review')).not.toBeNull());
 expect(screen.queryByText('HTML 正文 · 安全文本预览')).toBeNull();fireEvent.click(screen.getByRole('checkbox',{name:'包含 HTML 正文 · 合成'}));fireEvent.click(screen.getByText('HTML 正文 · 安全文本预览'));
 // Native details toggle is queued; wait for the preview to become observable.
 await waitFor(()=>expect(screen.getByText(/合成 HTML 正文示例/)).toBeTruthy());expect(container.querySelector('.m10-html-preview pre')?.children.length).toBe(0);expect(JSON.stringify(data)).toBe(before);expect(setData).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox',{name:'包含 HTML 正文 · 合成'}));expect(screen.queryByText('HTML 正文 · 安全文本预览')).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:'包含文字附件 · 合成'}));fireEvent.click(screen.getByRole('button',{name:'查看附件文字'}));expect(screen.getByText(/合成附件正文/)).toBeTruthy();expect(container.querySelector('.m10-attachment-preview pre')?.children.length).toBe(0);expect(JSON.stringify(data)).toBe(before);expect(setData).not.toHaveBeenCalled();
});
