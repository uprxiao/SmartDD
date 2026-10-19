import {describe,it,expect,vi} from 'vitest';
import {App} from '@modelcontextprotocol/ext-apps';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {createViewerAppBridge} from './bridge';
import type {ViewerSession} from '@shared/file-viewer';
const session:ViewerSession={id:'b7c94e9a-a5b9-40d1-8049-2696d982738c',adapterId:'fixture',generation:1,uri:'fixture://exact',writable:false,presentation:'mcp-app',resource:{uri:'fixture://exact',mimeType:'text/plain',base64:'eA==',bytes:1,etag:'a'.repeat(64)},subscribed:false,initialArguments:{uri:'fixture://exact'}};
describe('MCP production AppBridge bounded current-resource handlers',()=>{
 it('limits combined in-flight resource/tool calls to eight, releases slots and never invokes API for foreign URI',async()=>{
  const release:(()=>void)[]=[],api={readViewer:vi.fn(()=>new Promise<{uri:string;mimeType:string;base64:string}>(r=>release.push(()=>r({uri:session.uri,mimeType:'text/plain',base64:'eA=='})))),viewerTool:vi.fn(()=>new Promise<{content:[]}>(r=>release.push(()=>r({content:[]}))))};
  const host=createViewerAppBridge(session,api,'dark',e=>{throw e}),app=new App({name:'fixture',version:'1'},{},{autoResize:false}),[left,right]=InMemoryTransport.createLinkedPair();app.ontoolinput=()=>{};
  await host.connect(left);await app.connect(right);
  try{
   const pending=Array.from({length:8},(_,i)=>i%2?app.readServerResource({uri:session.uri}):app.callServerTool({name:'slice',arguments:{uri:session.uri}}));
   await vi.waitFor(()=>expect(release).toHaveLength(8));await expect(app.readServerResource({uri:session.uri})).rejects.toThrow('并发');
   await expect(app.readServerResource({uri:session.uri+'/other'})).rejects.toThrow('当前资源');expect(api.readViewer).toHaveBeenCalledTimes(4);expect(api.viewerTool).toHaveBeenCalledTimes(4);
   release.splice(0).forEach(f=>f());await Promise.all(pending);const next=app.readServerResource({uri:session.uri});await vi.waitFor(()=>expect(release).toHaveLength(1));release.splice(0).forEach(f=>f());expect(await next).toMatchObject({contents:[{uri:session.uri,blob:'eA=='}]});
  }finally{release.splice(0).forEach(f=>f());await app.close();await host.close()}
 });
});
