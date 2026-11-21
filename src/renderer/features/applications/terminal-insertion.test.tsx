// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {APPLICATION_SKILL_EXAMPLES} from '@shared/application-terminal';
import {ApplicationTerminalButton} from './terminal-insertion';

const f=vi.hoisted(()=>({prepare:vi.fn(),reference:vi.fn()}));
vi.mock('@renderer/core/navigation',()=>({navigation:{currentViewId:'apps',applicationAgentTaskId:'foreign-task',prepareApplicationTask:f.prepare}}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{tasks:[{taskId:'foreign-task',title:'Foreign task',projectId:'other'}]}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{agentTasks:{applicationReference:f.reference}}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

const skill={kind:'skill' as const,appId:'mail' as const,skillId:'work-assistant'};
it.each([false,true])('prepares the host example in the correct project only after a click, compact=%s',compact=>{
  render(<ApplicationTerminalButton projectId="p1" source={skill} variant="example" compact={compact} label="准备项目任务"/>);
  expect(f.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:compact?'准备项目任务':'准备新任务'}));
  expect(f.prepare).toHaveBeenCalledExactlyOnceWith('p1',APPLICATION_SKILL_EXAMPLES['mail:work-assistant']);
  expect(f.reference).not.toHaveBeenCalled();
});
it('does not redirect an existing reference to an unrelated task when there is no eligible target',()=>{
  render(<ApplicationTerminalButton projectId="p1" source={{kind:'draft',draftId:'draft',revision:1,contentHash:'hash'}} />);
  const action=screen.getByRole('button',{name:'插入任务引用'});
  expect(action).toHaveProperty('disabled',true);
  fireEvent.click(action);
  expect(f.reference).not.toHaveBeenCalled();
  expect(f.prepare).not.toHaveBeenCalled();
});
