// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared synthetic prototype source is JavaScript.
import {ApplicationPackage} from '@root/prototypes/m6-codex/src/IntegrationPackageUI.jsx';
// @ts-expect-error Shared synthetic model is JavaScript.
import {APP_DEFINITIONS,initialIntegrationState,projectIntegrationState} from '@root/prototypes/m6-codex/src/integration-model.mjs';
// @ts-expect-error Shared synthetic workspace is JavaScript.
import {IntegrationWorkspace} from '@root/prototypes/m6-codex/src/IntegrationWorkspace.jsx';
// @ts-expect-error Public package declarations are shared JavaScript metadata.
import {definitions} from '@root/resources/applications/definitions.mjs';
afterEach(cleanup);
const base=()=>projectIntegrationState(initialIntegrationState());
it.each(['zentao','mail'])('shows the declared %s package tools without treating candidate capabilities as installed tools',id=>{
 const app=APP_DEFINITIONS.find((a:{id:string})=>a.id===id),data=base(),before=JSON.stringify(data),onUse=vi.fn();
 const view=render(<ApplicationPackage app={app} data={data} projectId="ais" enabled onUse={onUse}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看工具与包内容'}));
 const declared=definitions.find((d:{appId:string})=>d.appId===id).tools;
 const rows=[...view.container.querySelectorAll('.m10-package-contents>div')];
 expect(rows.map(row=>row.querySelector('span')?.textContent)).toEqual(declared.map((tool:{name:string})=>tool.name));
 expect(rows.filter((_,index)=>declared[index].annotations.readOnlyHint).every(row=>row.querySelector('small')?.textContent==='读取')).toBe(true);
 if(id==='mail'){
  expect(rows.find(row=>row.textContent?.includes('smartdd_mail_draft_create_v1'))?.querySelector('small')?.textContent).toBe('本地准备 · 无需 SMTP');
  expect(rows.find(row=>row.textContent?.includes('smartdd_mail_send_execute_v1'))?.querySelector('small')?.textContent).toBe('SMTP 发送 · 需具体授权');
 }else expect(view.container.querySelector('.m10-package-contents')?.textContent).not.toContain('流转');
 expect(JSON.stringify(data)).toBe(before);expect(onUse).not.toHaveBeenCalled();
});
it('does not invent package tools for an unknown application',()=>{
 const app={...APP_DEFINITIONS[0],id:'future-app'},view=render(<ApplicationPackage app={app} data={base()} onUse={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看工具与包内容'}));
 expect(view.container.querySelectorAll('.m10-package-contents>div')).toHaveLength(0);
});
it('separates the approved quote,composer action and no-terminal explanation without submitting',()=>{
 const app=APP_DEFINITIONS.find((a:{id:string})=>a.id==='mail'),data=base(),before=JSON.stringify(data),onUse=vi.fn();const view=render(<ApplicationPackage app={app} data={data} projectId="ais" enabled terminalTarget={null} onUse={onUse}/>);expect(view.container.querySelector('.m10-terminal-insertion>p')?.textContent).toBe('“'+app.skills[0].prompt+'”');const button=screen.getByRole('button',{name:'准备新任务'});expect(screen.getByText('请先在本项目打开一个运行中的终端；不会自动选择其他任务。')).toBeTruthy();fireEvent.click(button);expect(onUse).toHaveBeenCalledExactlyOnceWith(app.skills[0].prompt);expect(JSON.stringify(data)).toBe(before);
});
it('describes an explicit current synthetic target separately from the prompt',()=>{
 const app=APP_DEFINITIONS.find((a:{id:string})=>a.id==='mail'),onUse=vi.fn();render(<ApplicationPackage app={app} data={base()} projectId="ais" enabled terminalTarget={{taskId:'own',ptyId:'own-pty',projectId:'ais'}} terminalTaskTitle="本次合成终端" onUse={onUse}/>);expect(screen.getByRole('button',{name:'插入示例到终端'})).toBeTruthy();expect(screen.getByText('目标：本次合成终端 · 仅插入，不自动回车')).toBeTruthy();expect(onUse).not.toHaveBeenCalled();
});
it.each(['unadded','global-off','no-project','project-off'])('keeps %s example disabled with its concrete reason',state=>{
 const app=APP_DEFINITIONS.find((a:{id:string})=>a.id==='mail'),data=base(),onUse=vi.fn();if(state==='unadded')data.installed=[];if(state==='global-off')data.globalApps.mail=false;render(<ApplicationPackage app={app} data={data} projectId={state==='no-project'?null:'ais'} enabled={state!=='project-off'} terminalTarget={null} onUse={onUse}/>);const reason=state==='unadded'?'请先添加应用':state==='global-off'?'请先启用应用':state==='no-project'?'请先选择项目':'请先在项目中启用应用';const button=screen.getByRole('button',{name:reason}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(button);expect(onUse).not.toHaveBeenCalled();
});

it('resets shared-prototype route scroll without replacing persisted business state',async()=>{
 const data=base(),before=JSON.stringify(data),props={projects:[{id:'ais',name:'AIS'}],tasks:[],selectedProjectId:'ais',onSelectProject:vi.fn(),integration:{data,setData:vi.fn(),storageFailed:false},nav:vi.fn(),onUsePrompt:vi.fn(),dark:false,onTheme:vi.fn()};const view=render(<IntegrationWorkspace {...props} route="apps/connections"/>);const content=view.container.querySelector('.m10-content') as HTMLElement;content.scrollTop=608;content.scrollLeft=24;view.rerender(<IntegrationWorkspace {...props} route="apps/mail"/>);await waitFor(()=>expect(content.scrollTop).toBe(0));expect(content.scrollLeft).toBe(0);expect(JSON.stringify(data)).toBe(before);expect(props.nav).not.toHaveBeenCalled();
});
