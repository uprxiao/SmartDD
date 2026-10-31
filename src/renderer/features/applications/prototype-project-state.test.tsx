// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared synthetic prototype is JavaScript.
import {ProjectApplications} from '@root/prototypes/m6-codex/src/IntegrationPackageUI.jsx';
// @ts-expect-error Shared synthetic prototype is JavaScript.
import {IntegrationWorkspace} from '@root/prototypes/m6-codex/src/IntegrationWorkspace.jsx';
// @ts-expect-error Shared synthetic model is JavaScript.
import {initialIntegrationState,projectIntegrationState} from '@root/prototypes/m6-codex/src/integration-model.mjs';
afterEach(cleanup);
const project={id:'ais',name:'本次项目',archived:false};
const base=()=>projectIntegrationState(initialIntegrationState());
it.each(['zentao','mail'])('PO-01 keeps %s selected but disables terminal entry while globally paused',appId=>{
 const data=base();data.projectApps.ais[appId]=true;data.globalApps[appId]=false;
 const before=JSON.stringify(data),onUse=vi.fn(),setData=vi.fn();const view=render(<ProjectApplications project={project} integration={{data,setData,storageFailed:false}} nav={vi.fn()} onUse={onUse}/>);
 const section=view.container.querySelector('.m10-project-application:has(.m10-appmark.'+appId+')') as HTMLElement;
 expect(within(section).getByRole('switch').getAttribute('aria-checked')).toBe('true');expect(within(section).getByText('应用已全局停用')).toBeTruthy();
 const button=within(section).getByRole('button',{name:'在 WillYou 终端使用'}) as HTMLButtonElement;
 expect(button.disabled).toBe(true);fireEvent.click(button);expect(onUse).not.toHaveBeenCalled();expect(setData).not.toHaveBeenCalled();expect(JSON.stringify(data)).toBe(before);
});
it.each(['project-off','archived','no-connection','ready'])('preserves the P04 %s terminal boundary without treating health as selection',state=>{
 const data=base();data.projectApps.ais.mail=state!=='project-off';if(state==='no-connection'){data.bindings.ais=[];data.connections=[];}
 const onUse=vi.fn();const view=render(<ProjectApplications project={{...project,archived:state==='archived'}} integration={{data,setData:vi.fn(),storageFailed:false}} nav={vi.fn()} onUse={onUse}/>);
 const section=view.container.querySelector('.m10-project-application:has(.m10-appmark.mail)') as HTMLElement,button=within(section).getByRole('button',{name:'在 WillYou 终端使用'}) as HTMLButtonElement;
 expect(button.disabled).toBe(state==='project-off'||state==='archived');fireEvent.click(button);expect(onUse).toHaveBeenCalledTimes(button.disabled?0:1);
});
it.each(['','missing','archived'])('PO-02 shows an explicit project choice for %s instead of fabricating a project owner',selection=>{
 const data=base(),before=JSON.stringify(data),onUsePrompt=vi.fn(),onNewProjectTask=vi.fn(),projects=[project,{id:'archived',name:'旧归档项目',archived:true}];
 const view=render(<IntegrationWorkspace route="apps/connections" projects={projects} tasks={[]} selectedProjectId={selection} onSelectProject={vi.fn()} integration={{data,setData:vi.fn(),storageFailed:false}} nav={vi.fn()} onUsePrompt={onUsePrompt} onNewProjectTask={onNewProjectTask} dark={false} onTheme={vi.fn()}/>);
 expect(screen.getByText('选择一个项目')).toBeTruthy();expect(view.container.querySelector('.m10-project-apps')).toBeNull();
 expect(within(screen.getByLabelText('当前应用项目')).getByRole('option',{name:'选择项目'})).toHaveProperty('value','');expect(onUsePrompt).not.toHaveBeenCalled();expect(onNewProjectTask).not.toHaveBeenCalled();expect(JSON.stringify(data)).toBe(before);
});

it.each(['zentao','mail'])('SE unadded %s offers explicit application recovery without adding or enabling it',appId=>{
 const data=base();data.installed=[];data.bindings.ais=[];const before=JSON.stringify(data),nav=vi.fn(),setData=vi.fn();const view=render(<ProjectApplications project={project} integration={{data,setData,storageFailed:false}} nav={nav} onUse={vi.fn()}/>);
 const section=view.container.querySelector('.m10-project-application:has(.m10-appmark.'+appId+')') as HTMLElement;const name=appId==='mail'?'邮件':'禅道';expect(within(section).getByRole('switch')).toHaveProperty('disabled',true);for(const radio of within(section).getAllByRole('radio'))expect(radio).toHaveProperty('disabled',true);
 fireEvent.click(within(section).getByRole('button',{name:'先添加'+name+'应用'}));expect(nav).toHaveBeenCalledExactlyOnceWith('apps/'+appId);expect(setData).not.toHaveBeenCalled();expect(JSON.stringify(data)).toBe(before);
});

it.each(['zentao','mail'])('SF locks %s enablement and terminal during ambiguity while keeping explicit source repair available',appId=>{
 const data=base(),old=data.connections.find((c:any)=>c.app===appId);const copy={...old,id:'sf-duplicate'};data.connections.push(copy);data.bindings.ais=[old.id,copy.id];data.projectApps.ais[appId]=true;const view=render(<ProjectApplications project={project} integration={{data,setData:vi.fn(),storageFailed:false}} nav={vi.fn()} onUse={vi.fn()}/>);const section=view.container.querySelector('.m10-project-application:has(.m10-appmark.'+appId+')')as HTMLElement;expect(within(section).getByRole('switch')).toHaveProperty('disabled',true);expect(within(section).getByRole('button',{name:'在 WillYou 终端使用'})).toHaveProperty('disabled',true);expect(within(section).getAllByRole('radio').every(x=>!(x as HTMLInputElement).disabled)).toBe(true);
});
