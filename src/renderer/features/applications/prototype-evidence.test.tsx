// @vitest-environment jsdom
// T69 P/U: synthetic prototype evidence semantics; no CLI or packaged-App claim.
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared synthetic prototype is JavaScript.
import {SessionApplications} from '@root/prototypes/m6-codex/src/IntegrationPackageUI.jsx';
// @ts-expect-error Shared synthetic model is JavaScript.
import {initialIntegrationState,integrationSnapshot,projectIntegrationState} from '@root/prototypes/m6-codex/src/integration-model.mjs';

afterEach(cleanup);
const data=()=>projectIntegrationState(initialIntegrationState());
function setup(){
 const state=data(),onUse=vi.fn(),onContinue=vi.fn(),onNewTask=vi.fn(),setData=vi.fn();
 const task={id:'evidence-a',title:'合成A',project:'ais',runner:'codex',status:'running',integrationSnapshot:integrationSnapshot(state,'ais')};
 const props={task,integration:{data:state,setData},onUse,onContinue,onNewTask,nav:vi.fn()};
 return {...render(<SessionApplications {...props}/>),props,onUse,onContinue,onNewTask,setData};
}
it('keeps file, bridge, discovery, body reading and completed calls independent',()=>{
 const h=setup(),current=()=>screen.getByLabelText('邮件当前分层证据').textContent;
 expect(current()).toContain('工具桥：未验证');expect(current()).toContain('工具请求：0次');
 fireEvent.change(screen.getByRole('combobox',{name:'邮件工具桥证据'}),{target:{value:'verified'}});
 expect(current()).toContain('本运行曾核验');expect(current()).toContain('Agent发现：未验证');expect(current()).toContain('Agent读取：未验证');
 fireEvent.change(screen.getByRole('combobox',{name:'邮件工具调用证据'}),{target:{value:'success'}});
 expect(current()).toContain('工具请求：1次，调用完成 1次');expect(current()).toContain('Agent发现：未验证');expect(current()).toContain('Agent读取：未验证');
 fireEvent.change(screen.getByRole('combobox',{name:'邮件工具调用证据'}),{target:{value:'none'}});
 fireEvent.change(screen.getByRole('combobox',{name:'邮件 Skill发现状态'}),{target:{value:'verified'}});
 expect(current()).toContain('Agent读取：未验证');expect(current()).toContain('工具请求：0次');
 fireEvent.change(screen.getByRole('combobox',{name:'邮件 Skill读取状态'}),{target:{value:'verified'}});
 expect(current()).toContain('已核验本次原生读取');expect(current()).toContain('工具请求：0次');
 for(const mode of ['failed','unknown']){
  fireEvent.change(screen.getByRole('combobox',{name:'邮件工具调用证据'}),{target:{value:mode}});
  expect(current()).toContain('工具请求：1次，调用完成 0次');
 }
 expect(current()).toContain('结果未知，先核实原执行，不自动重发');
 for(const fn of [h.onUse,h.onContinue,h.onNewTask,h.setData])expect(fn).not.toHaveBeenCalled();
});
it('retains original simulated run observations without copying them into the next run or another task',()=>{
 const h=setup();expect(screen.getByText('尚未模拟历史运行证据，不补造发现、读取或调用记录。')).toBeTruthy();
 for(const name of ['邮件工具桥证据','邮件 Skill发现状态','邮件 Skill读取状态'])fireEvent.change(screen.getByRole('combobox',{name}),{target:{value:'verified'}});
 fireEvent.change(screen.getByRole('combobox',{name:'邮件工具调用证据'}),{target:{value:'success'}});
 fireEvent.click(screen.getByRole('button',{name:'模拟下一次运行证据'}));
 const history=screen.getByLabelText('合成历史运行 evidence-a/demo-run-1');expect(within(history).getByText(/已核验本次原生读取/)).toBeTruthy();expect(history.textContent).toContain('调用完成 1次');
 const current=screen.getByLabelText('邮件当前分层证据');expect(current.textContent).toContain('evidence-a/demo-run-2');expect(current.textContent).toContain('Agent读取：未验证');expect(current.textContent).toContain('工具请求：0次');
 h.rerender(<SessionApplications {...h.props} task={{...h.props.task,id:'evidence-b',title:'合成B'}}/>);
 expect(screen.queryByLabelText('合成历史运行 evidence-a/demo-run-1')).toBeNull();expect(screen.getByLabelText('邮件当前分层证据').textContent).toContain('evidence-b/demo-run-1');
 for(const fn of [h.onUse,h.onContinue,h.onNewTask,h.setData])expect(fn).not.toHaveBeenCalled();
});

it('PD shows synthetic attempts and next-step without promoting history into the next run',()=>{
 const h=setup(),current=()=>screen.getByLabelText('邮件当前分层证据').textContent;fireEvent.change(screen.getByRole('combobox',{name:'邮件工具调用证据'}),{target:{value:'failed'}});expect(current()).toContain('本次记录 3 次尝试');expect(current()).toContain('稍后明确发起新调用');fireEvent.change(screen.getByRole('combobox',{name:'邮件最近调用失败场景'}),{target:{value:'AUTH_FAILED'}});expect(current()).toContain('本次记录 1 次尝试');expect(current()).toContain('检查原连接并重新认证');fireEvent.click(screen.getByRole('button',{name:'模拟下一次运行证据'}));expect(current()).not.toContain('最近调用：');expect(screen.getByLabelText('合成历史运行 evidence-a/demo-run-1').textContent).toContain('检查原连接并重新认证');for(const fn of[h.onUse,h.onContinue,h.onNewTask,h.setData])expect(fn).not.toHaveBeenCalled();
});
it.each([['unknown-history','历史能力未知'],['not-recorded','本任务尚无已记录的固定能力'],['corrupt','固定能力快照损坏'],['unsupported-schema','原能力快照格式暂不支持']])('PV distinguishes %s from fixed selection without mutating the original task', (mode,text)=>{
 const h=setup(),before=JSON.stringify(h.props);fireEvent.change(screen.getByRole('combobox',{name:'会话诊断场景'}),{target:{value:mode}});expect(screen.getByRole('status').textContent).toContain(text);expect(h.container.textContent).not.toContain('会话固定 v');expect(screen.queryByLabelText('邮件当前分层证据')).toBeNull();expect(JSON.stringify(h.props)).toBe(before);for(const fn of[h.onUse,h.onContinue,h.onNewTask,h.setData])expect(fn).not.toHaveBeenCalled();fireEvent.change(screen.getByRole('combobox',{name:'会话诊断场景'}),{target:{value:'recorded'}});expect(screen.getByLabelText('邮件当前分层证据')).toBeTruthy();
});
it('PV reading state hides old fixed data and actions while preserving the original task and state',()=>{const h=setup(),before=JSON.stringify(h.props);fireEvent.change(screen.getByRole('combobox',{name:'会话诊断场景'}),{target:{value:'reading'}});expect(screen.getByText('正在核对原会话')).toBeTruthy();expect(screen.queryByLabelText('邮件当前分层证据')).toBeNull();expect(screen.queryByRole('button',{name:'复制脱敏诊断'})).toBeNull();expect(JSON.stringify(h.props)).toBe(before);for(const fn of[h.onUse,h.onContinue,h.onNewTask,h.setData])expect(fn).not.toHaveBeenCalled();});
it('PV read failure has an explicit synthetic retry and does not display stale fixed data as current',()=>{const h=setup(),before=JSON.stringify(h.props);fireEvent.change(screen.getByRole('combobox',{name:'会话诊断场景'}),{target:{value:'read-error'}});expect(screen.getByText('会话诊断未完成')).toBeTruthy();expect(screen.queryByLabelText('邮件当前分层证据')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'重试读取 · 模拟'}));expect(screen.getByLabelText('邮件当前分层证据')).toBeTruthy();expect(JSON.stringify(h.props)).toBe(before);for(const fn of[h.onUse,h.onContinue,h.onNewTask,h.setData])expect(fn).not.toHaveBeenCalled();});

it('QA refresh and close are synthetic view actions preserving the original task and business state',()=>{const h=setup(),before=JSON.stringify(h.props);fireEvent.click(screen.getByRole('button',{name:'重新核对 · 模拟'}));expect(screen.getByRole('status').textContent).toContain('不读取本机配置或日志');expect(h.setData).not.toHaveBeenCalled();expect(h.onNewTask).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'关闭'}));expect(h.onContinue).toHaveBeenCalledTimes(1);expect(JSON.stringify(h.props)).toBe(before);});

it('QD normal connection inspection navigates only to the selected application without changing the original task or selection',()=>{
 const h=setup(),before=JSON.stringify(h.props);fireEvent.click(screen.getByRole('button',{name:'检查邮件与连接'}));expect(h.props.nav).toHaveBeenCalledWith('apps/mail');expect(h.setData).not.toHaveBeenCalled();expect(h.onUse).not.toHaveBeenCalled();expect(h.onNewTask).not.toHaveBeenCalled();expect(JSON.stringify(h.props)).toBe(before);
});
it('QD source details retain only the original fixed synthetic package and refuse to invent unknown-history provenance',()=>{
 const h=setup(),version=h.props.task.integrationSnapshot.packages.find((p:{id:string})=>p.id==='mail').version;
 const source=()=>h.container.querySelector('.m10-session-app:has(.m10-appmark.mail) .m10-session-sources')!;
 expect(source()).toBeTruthy();expect(source().textContent).toContain('合成包 mail@'+version);expect(source().textContent).toContain('/合成示例/会话/evidence-a/mail/'+version+'/');expect(source().textContent).toContain('未读取实际包哈希');
 const next={...h.props,integration:{...h.props.integration,data:{...h.props.integration.data,packages:{...h.props.integration.data.packages,mail:'9.9.9'}}}};h.rerender(<SessionApplications {...next}/>);expect(source().textContent).toContain('合成包 mail@'+version);expect(source().textContent).not.toContain('9.9.9');
 fireEvent.change(screen.getByRole('combobox',{name:'会话诊断场景'}),{target:{value:'unknown-history'}});expect(source().textContent).toContain('本会话未选用');expect(source().textContent).not.toContain('/合成示例/会话/');expect(h.setData).not.toHaveBeenCalled();expect(h.onUse).not.toHaveBeenCalled();expect(h.onNewTask).not.toHaveBeenCalled();
});

it.each(['stopped','unavailable'])('QE %s example prepares only original-project editable input and retains the original session',mode=>{
 const h=setup();if(mode==='stopped')h.rerender(<SessionApplications {...h.props} task={{...h.props.task,status:'stopped'}}/>);else fireEvent.change(screen.getByRole('combobox',{name:'邮件应用故障场景'}),{target:{value:'missing'}});
 const before=JSON.stringify(h.props),card=h.container.querySelector('.m10-session-app:has(.m10-appmark.mail)')!,button=within(card as HTMLElement).getByRole('button',{name:'准备新任务'});expect(button.textContent).toContain('本地邮件');fireEvent.click(button);expect(h.onNewTask).toHaveBeenCalledWith('找出今天与当前项目有关的本地邮件，总结待办事项，并准备需要回复的草稿。');expect(h.onUse).not.toHaveBeenCalled();expect(h.setData).not.toHaveBeenCalled();expect(JSON.stringify(h.props)).toBe(before);
});
