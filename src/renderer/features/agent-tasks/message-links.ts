import {rpc} from '@renderer/lib/ipc';import {fileWorkspaceFor} from '@renderer/features/files/workspace-store';import {panelsFor} from './workspace-panels-store';import {openBrowserLink} from '@renderer/features/browser/store';
export async function resolveMessageLink(taskId:string,itemId:string,href:string){return rpc.agentTasks.resolveLink({taskId,itemId,href});}
export async function openMessageLink(taskId:string,itemId:string,href:string,external=false){const target=await resolveMessageLink(taskId,itemId,href);const scope={kind:'task' as const,taskId};
 if(target.kind==='web'){if(external)throw Error('修饰键只用于在外部编辑器打开已授权文件');await openBrowserLink(taskId,target.url);return;}
 const store=fileWorkspaceFor(scope);await store.initialize();const root=store.roots.roots.find(r=>r.sourceId===target.source.id&&r.source===target.source.kind);if(!root)throw Error('文件根已经变化，请刷新文件区');
 if(external){const action={kind:'path' as const,path:{lease:root.lease,generation:root.generation,relativePath:target.relativePath},directory:target.directory};const list=await rpc.files.applications(action);if(!list.preferredId||list.preferredUnavailable)throw Error('尚未配置可用的外部编辑器，请在文件区“打开方式”中选择');await rpc.files.openExternal({listId:list.id,appId:list.preferredId,remember:false});return;}
 panelsFor(scope).open('files');if(target.directory){store.selectRoot(root);const parts=target.relativePath.split('/').filter(Boolean);for(let n=1;n<=parts.length;n++){const dir=parts.slice(0,n).join('/');if(!store.currentExpanded.includes(dir))await store.toggleDirectory(dir);}return;}
 await store.open(root,target.relativePath,true,{line:target.line,column:target.column});
}
