// @vitest-environment jsdom
// Prototype component U only; no browser, packaged App or visual acceptance.
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared approved prototype is JavaScript.
import {PackageUpgradePreview} from '@root/prototypes/m6-codex/src/IntegrationPackageUI.jsx';
// @ts-expect-error Shared synthetic prototype model is JavaScript.
import {initialIntegrationState,projectIntegrationState} from '@root/prototypes/m6-codex/src/integration-model.mjs';

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{cleanup();vi.useRealTimers();});
it('rechecks changed preflight while waiting and before completing synthetic preparation',()=>{
 for(const phase of ['waiting','preparing']){
  let current=projectIntegrationState(initialIntegrationState());const before=structuredClone(current),active={id:'active',title:'共享目录占用',runner:'codex',status:'running'};
  function Harness({running}:{running:boolean}){const[data,setData]=useState(current);current=data;return <PackageUpgradePreview data={data} setData={setData} tasks={running?[active]:[]}/>;}
  const view=render(<Harness running={phase==='waiting'}/>);fireEvent.click(screen.getByRole('button',{name:'模拟升级并保留数据'}));fireEvent.change(screen.getByRole('combobox',{name:'升级预检场景'}),{target:{value:'blocked'}});if(phase==='waiting')view.rerender(<Harness running={false}/>);act(()=>vi.advanceTimersByTime(1000));expect(current).toEqual(before);expect(screen.getByText('预检尚未通过，原默认版本和历史保留。')).toBeTruthy();view.unmount();
 }
});
it('cancels only synthetic maintenance waiting while keeping the running Agent and original defaults',()=>{
 const tasks=[{id:'active',title:'无关Agent合成任务',runner:'codex',status:'running'}];let current=projectIntegrationState(initialIntegrationState());
 function Harness(){const[data,setData]=useState(current);current=data;return <PackageUpgradePreview data={data} setData={setData} tasks={tasks}/>;}
 render(<Harness/>);const before=structuredClone(current);fireEvent.click(screen.getByRole('button',{name:'模拟升级并保留数据'}));expect(screen.getByText(/正在等待以下运行释放共享目录/)).toBeTruthy();act(()=>vi.advanceTimersByTime(2000));expect(current).toEqual(before);
 fireEvent.click(screen.getByRole('button',{name:'取消等待 · 模拟'}));act(()=>vi.advanceTimersByTime(2000));expect(current).toEqual(before);expect(tasks[0].status).toBe('running');expect(screen.getByText(/已取消本次维护等待/)).toBeTruthy();expect(screen.queryByRole('button',{name:'取消等待 · 模拟'})).toBeNull();
});
it('waits for release and complete preparation before changing a synthetic default',()=>{
 let current=projectIntegrationState(initialIntegrationState());const setData=vi.fn((update:(previous:typeof current)=>typeof current)=>{current=update(current);}),task={id:'active',title:'共享目录占用',runner:'codex',status:'running'};
 const view=render(<PackageUpgradePreview data={current} setData={setData} tasks={[task]}/>);fireEvent.click(screen.getByRole('button',{name:'模拟升级并保留数据'}));act(()=>vi.advanceTimersByTime(1000));expect(setData).not.toHaveBeenCalled();
 view.rerender(<PackageUpgradePreview data={current} setData={setData} tasks={[{...task,status:'stopped'}]}/>);expect(screen.getByText(/正在准备和校验/)).toBeTruthy();act(()=>vi.advanceTimersByTime(449));expect(setData).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(1));expect(current.packages).toEqual({zentao:'1.1.0',mail:'1.1.0'});expect(task.status).toBe('running');
});
it('keeps synthetic defaults unchanged for blocked/unknown preflight and upgrades only after a ready check',()=>{
 let current=projectIntegrationState(initialIntegrationState());
 function Harness(){const[data,setData]=useState(current);current=data;return <PackageUpgradePreview data={data} setData={setData}/>;}
 render(<Harness/>);const before=structuredClone(current);
 for(const scene of ['blocked','unavailable']){
  fireEvent.change(screen.getByRole('combobox',{name:'升级预检场景'}),{target:{value:scene}});
  if(scene==='blocked')for(const text of ['邮件 v1.0.0 · 原版本','会话：邮件汇总（示例）','连接：本地邮件（示例）','动作范围：读取邮件、正文及附件（依赖此连接的部分）'])expect(screen.getByText(text)).toBeTruthy();
  else expect(screen.getByText('升级状态无法核验')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'模拟升级并保留数据'}));act(()=>vi.advanceTimersByTime(1000));expect(current).toEqual(before);expect(screen.getByText('预检尚未通过，原默认版本和历史保留。')).toBeTruthy();
 }
 fireEvent.change(screen.getByRole('combobox',{name:'升级预检场景'}),{target:{value:'ready'}});fireEvent.click(screen.getByRole('button',{name:'模拟升级并保留数据'}));expect(current.packages).toEqual(before.packages);act(()=>vi.advanceTimersByTime(450));expect(current.packages).toEqual({zentao:'1.1.0',mail:'1.1.0'});expect(current.connections).toEqual(before.connections);expect(current.bindings).toEqual(before.bindings);
});

it('separates synthetic cleanup waiting from processing without changing application data',()=>{
 const current=projectIntegrationState(initialIntegrationState()),setData=vi.fn();render(<PackageUpgradePreview data={current} setData={setData}/>);const before=structuredClone(current);
 fireEvent.change(screen.getByRole('combobox',{name:'版本清理阶段'}),{target:{value:'waiting'}});expect(screen.getByText('正在等待版本资源空闲；尚未开始清理，可以取消等待。无关 Agent 可继续工作。')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'取消本次清理等待 · 模拟'}));expect(screen.getByText(/已取消本次清理等待；仅合成演示/)).toBeTruthy();
 fireEvent.change(screen.getByRole('combobox',{name:'版本清理阶段'}),{target:{value:'executing'}});expect(screen.getByText('正在核对并清理版本文件；已进入清理处理，不能取消等待。完成前不报告释放空间。')).toBeTruthy();expect((screen.getByRole('button',{name:'取消本次清理等待 · 模拟'}) as HTMLButtonElement).disabled).toBe(true);expect(setData).not.toHaveBeenCalled();expect(current).toEqual(before);
});

it('shows synthetic publication phases without making the old default, task or serialized business data usable or replaced',()=>{
 const current=projectIntegrationState(initialIntegrationState()),before=structuredClone(current),setData=vi.fn();render(<PackageUpgradePreview data={current} setData={setData}/>);
 for(const[state,text]of[['staged','准备未完成'],['verified','已校验，发布未完成'],['recovery-required','恢复待核查'],['unknown','阶段待核查'],['ready','已发布']]){fireEvent.change(screen.getByRole('combobox',{name:'应用包发布阶段'}),{target:{value:state}});expect(screen.getByLabelText('发布阶段合成预览').textContent).toContain(text);expect(setData).not.toHaveBeenCalled();expect(current).toEqual(before);}
});
