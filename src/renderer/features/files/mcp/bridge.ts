import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { VIEWER_LIMITS, type ViewerResourceInput, type ViewerSession } from '@shared/file-viewer';
interface ViewerBridgeApi {
  viewerTool(context: ViewerResourceInput, name: string, args: Record<string, unknown>): Promise<unknown>;
  readViewer(context: ViewerResourceInput): Promise<{uri:string;mimeType:string;base64:string}>;
}
/** No raw MCP client: each handler returns through the owner/resource-scoped IPC. */
export function createViewerAppBridge(session: ViewerSession, api: ViewerBridgeApi, theme: 'light' | 'dark', fail: (error: unknown) => void): AppBridge {
  const context = {id:session.id,uri:session.uri,generation:session.generation};
  const bridge = new AppBridge(null, {name:'WillYou',version:'1.0.0'}, {serverTools:{},serverResources:{}}, {hostContext:{theme}});
  const reject = async () => { throw new Error('此文件查看器没有该宿主能力'); };
  let pending=0;
  const bounded=async<T>(run:()=>Promise<T>):Promise<T>=>{if(pending>=VIEWER_LIMITS.uiRequests)throw new Error('扩展并发请求超过8条');pending++;try{return await run()}finally{pending--}};
  bridge.oncalltool = async params => bounded(()=>api.viewerTool(context, params.name, params.arguments ?? {})) as never;
  bridge.onreadresource = async params => {
    if (params.uri !== session.uri) throw new Error('扩展只能读取当前资源');
    const resource = await bounded(()=>api.readViewer(context));
    return {contents:[{uri:resource.uri,mimeType:resource.mimeType,blob:resource.base64}]};
  };
  bridge.onmessage=reject;bridge.onopenlink=reject;bridge.ondownloadfile=reject;bridge.onupdatemodelcontext=reject;
  bridge.oninitialized=()=>{void (async()=>{
    await bridge.sendToolInput({arguments:session.initialArguments??{}});
    if(session.initialResult)await bridge.sendToolResult(session.initialResult as never);
  })().catch(fail)};
  return bridge;
}
