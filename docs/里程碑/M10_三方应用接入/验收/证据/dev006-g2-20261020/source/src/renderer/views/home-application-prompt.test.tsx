// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {HomeView} from './home-view';
import {navigation} from '@renderer/core/navigation';
const m=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),projects:[{id:'p1',name:'Original project'}],profiles:[{id:'profile',name:'Private profile',runner:'codex',isDefault:true}],draft:{projectId:'p1',dirId:'dir1',aiProfileId:'profile'},project:{id:'p1',name:'Original project',dirs:[{id:'dir1',path:'/private/fixture',label:'Fixture',isDefault:true,status:{available:true}}]}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@renderer/lib/hooks/useProjects',()=>({useProjectList:()=>({data:m.projects}),useProject:()=>({data:m.project})}));
vi.mock('@renderer/lib/hooks/useAiProfiles',()=>({useAiProfiles:()=>({data:m.profiles})}));
vi.mock('@renderer/lib/hooks/useAppSettingsKey',()=>({useAppSettingsKey:()=>({value:m.draft,update:m.update})}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{create:m.create}}));
vi.mock('./voice-controls',()=>({VoiceButton:()=>null}));
vi.mock('./capabilities',()=>({CapabilityLaunchPreview:()=>null}));
vi.mock('./projects/project-dialogs',()=>({ProjectDialog:()=>null}));
vi.mock('@renderer/lib/profile-health',()=>({ProfileHealthMark:()=>null}));
beforeEach(()=>{vi.clearAllMocks();navigation.homePreset=null;navigation.currentProjectId=null;navigation.currentTaskId=null;navigation.currentViewId='home';m.projects.splice(0,m.projects.length,{id:'p1',name:'Original project'});});
afterEach(()=>cleanup());
describe('application example handoff to the real home composer',()=>{
 it('appends an explicit example to existing editable input,focuses it,and starts no task',async()=>{render(<HomeView/>);const input=await screen.findByTestId('home-input');fireEvent.change(input,{target:{value:'existing-prefix'}});act(()=>navigation.prepareApplicationTask('p1','approved example'));await waitFor(()=>expect(input).toHaveProperty('value','existing-prefix\napproved example'));expect(document.activeElement).toBe(input);expect(navigation.homePreset?.applicationPrompt).toBeUndefined();expect(m.create).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
 it('consumes one handoff once across rerenders while preserving later user edits',async()=>{act(()=>navigation.prepareApplicationTask('p1','first example'));const view=render(<HomeView/>);const input=await screen.findByTestId('home-input');await waitFor(()=>expect(input).toHaveProperty('value','first example'));fireEvent.change(input,{target:{value:'first example plus user words'}});view.rerender(<HomeView/>);expect(input).toHaveProperty('value','first example plus user words');expect(m.create).not.toHaveBeenCalled();});
 it('does not apply a missing project handoff to the existing project or launch a task',async()=>{act(()=>navigation.prepareApplicationTask('deleted-project','foreign example'));render(<HomeView/>);const input=await screen.findByTestId('home-input');expect(input).toHaveProperty('value','');expect(m.create).not.toHaveBeenCalled();expect(navigation.homePreset?.applicationPrompt).toBe('foreign example');});
});
