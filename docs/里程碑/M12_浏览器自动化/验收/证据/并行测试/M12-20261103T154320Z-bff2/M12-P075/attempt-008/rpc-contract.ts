import type {rpc} from './source017/src/renderer/lib/ipc';
declare const api:typeof rpc;
const taskId='00000000-0000-4000-8000-000000000001';
const projectId='00000000-0000-4000-8000-000000000002';
async function actualUsedInterfaces(){
 const catalog=await api.applications.catalog();if(catalog.ok){const item=catalog.value.find(x=>x.appId==='browser');if(item)await api.applications.setAdded('browser',true,item.revision)}
 await api.applications.projectSettings(projectId,'browser');
 await api.applications.select({projectId,appId:'browser',enabled:true,expectedRevision:0,connections:{}});
 await api.projects.create({name:'[A] P075',aliases:[],description:'fixture',rulesPath:null},[{label:'fixture',path:'/private/tmp/fixture'}]);
 const profile=await api.aiProfiles.create({name:'fixture',runner:'codex',executable:'/private/tmp/fixture',args:[],env:[{name:'HOME',value:'/private/tmp/fixture',secret:false}],color:null,isDefault:true});
 await api.aiProfiles.get(profile.id);await api.tasks.create({projectId,dirId:null,aiProfileId:profile.id,firstMessage:'fixture'});await api.tasks.rename(taskId,'fixture');await api.tasks.get(taskId);await api.tasks.kill(taskId);await api.applications.session(taskId);
 const workspace=await api.browser.snapshot({taskId});const prefs=await api.browser.preferences({taskId});
 const id:string|null=workspace.activeId;const bytes:number=prefs.artifactBytes;const downloads=workspace.downloads;const tabs=workspace.tabs;for(const tab of tabs){const title:string=tab.title;const back:boolean=tab.canGoBack;void title;void back}void id;void bytes;void downloads;
}
void actualUsedInterfaces;
