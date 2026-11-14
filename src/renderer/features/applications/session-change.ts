import type {SessionChangeImpact,SessionChangeQuery} from '@shared/session-change-impact';
import {rpc} from '@renderer/lib/ipc';
import {unwrap} from './api';
export const readSessionChangeImpact=async(query:SessionChangeQuery)=>unwrap(await rpc.applications.sessionChangeImpact(query));
const effects={
 'plugin-off':'运行中的会话即刻不能再调用它，新建或恢复的会话不再加载',
 'plugin-on':'新建或恢复的会话即可使用',
 'plugin-update':'插件调用立即使用新版本',
 'plugin-remove':'运行中的会话即刻不能再调用它',
 'cap-off':'新建或恢复的会话不再加载',
 'cap-on':'新建或恢复的会话即可使用',
 'project-off':'本项目运行中的会话即刻不能再调用它，新建或恢复的会话不再加载',
 'project-on':'本项目新建或恢复的会话即可使用',
};
export function sessionChangeMessage(kind:keyof typeof effects,impact:SessionChangeImpact){
 if(kind.startsWith('project-')&&impact.globalDisabled)return '插件已停用，全局停用优先；全局启用后按项目设置生效';
 return effects[kind]+(impact.runningCount>0?`；${impact.runningCount} 个运行中的会话重启后完全生效`:'');
}

export function projectSessionChangeMessage(name:string,enabled:boolean,impact:SessionChangeImpact){
 const prefix=`${name} 已在本项目${enabled?'启用':'关闭'}`;
 return impact.globalDisabled?`${prefix}；插件当前已全局停用，全局启用后按本项目设置生效`:`${prefix}：${sessionChangeMessage(enabled?'project-on':'project-off',impact)}`;
}
