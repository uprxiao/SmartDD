import {expect,it,vi} from 'vitest';
vi.mock('@renderer/lib/ipc',()=>({rpc:{applications:{}}}));
import {sessionChangeMessage,projectSessionChangeMessage} from './session-change';
it('shares the approved restart explanation and omits the count at zero',()=>{
 expect(sessionChangeMessage('cap-off',{runningCount:0,globalDisabled:false,checkedAt:'now'})).toBe('新建或恢复的会话不再加载');
 expect(sessionChangeMessage('plugin-update',{runningCount:2,globalDisabled:false,checkedAt:'now'})).toBe('插件调用立即使用新版本；2 个运行中的会话重启后完全生效');
});
it('never promises project availability while global disable takes precedence',()=>{
 expect(sessionChangeMessage('project-on',{runningCount:0,globalDisabled:true,checkedAt:'now'})).toBe('插件已停用，全局停用优先；全局启用后按项目设置生效');
});

it('identifies the changed project plugin and keeps global-disable priority without a restart count',()=>{
 expect(projectSessionChangeMessage('禅道',false,{runningCount:1,globalDisabled:false,checkedAt:'now'})).toBe('禅道 已在本项目关闭：本项目运行中的会话即刻不能再调用它，新建或恢复的会话不再加载；1 个运行中的会话重启后完全生效');
 expect(projectSessionChangeMessage('浏览器',true,{runningCount:4,globalDisabled:true,checkedAt:'now'})).toBe('浏览器 已在本项目启用；插件当前已全局停用，全局启用后按本项目设置生效');
});
