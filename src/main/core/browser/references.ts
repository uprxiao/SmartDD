import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { BrowserCdpProxy, type BrowserAXTree } from './cdp-proxy';
import { BrowserHelper } from './agent-browser';
import { BROWSER_GUARD_SOURCE, BROWSER_GUARD_WORLD } from './action-guard';
import { staleReference, BrowserError } from './errors';
import { browserAXIdentityMatches, browserAXRoleKey, indexBrowserAXTrees, type BrowserNodeIdentity } from './ax-identity';

type NodeRef = BrowserNodeIdentity;
interface GuardState { blocked: string[]; accepted: string[]; connected: boolean }
interface ActionOptions { signal?: AbortSignal; dispatched?: () => void; notStarted?: () => void }
interface ArmedReference {
  selector: string;
  node: NodeRef;
  hostClick: boolean;
  click(options?: ActionOptions): Promise<{ clicked: string; path: 'cdp' }>;
  fill(value: string, options?: ActionOptions): Promise<{ filled: string }>;
  finish(): Promise<GuardState>;
}
interface FrameTree { frame: { id: string }; childFrames?: FrameTree[] }
const helperSnapshotSchema = z.object({
  snapshot: z.string(), refs: z.record(z.string().regex(/^e\d+$/), z.object({ role: z.string(), name: z.string().default('') })), origin: z.string().optional(),
});
export class BrowserReferences {
  private generation = 0;
  private refs = new Map<string, NodeRef>();
  private worlds = new Map<string, number>();
  constructor(private readonly proxy: BrowserCdpProxy, private readonly pageShort: string) {
    proxy.initializeFrames(session => this.initialize(session));
    proxy.onEvent(event => {
      if (event.method === 'Page.frameNavigated') this.invalidate();
      if (event.method === 'Runtime.executionContextCreated') {
        const context=event.params.context as {id:number;name:string;auxData?:{frameId?:string}};
        if(context?.name===BROWSER_GUARD_WORLD&&context.auxData?.frameId)this.worlds.set((event.sessionId??'')+'\0'+context.auxData.frameId,context.id);
      }
      if(event.method==='Runtime.executionContextsCleared')for(const key of this.worlds.keys())if(key.startsWith((event.sessionId??'')+'\0'))this.worlds.delete(key);
      if(event.method==='Runtime.executionContextDestroyed')for(const [key,id] of this.worlds)if(id===event.params.executionContextId&&key.startsWith((event.sessionId??'')+'\0'))this.worlds.delete(key);
    });
  }
  invalidate(): void { this.generation++; this.refs.clear(); }
  async initialize(sessionId?: string): Promise<void> {
    // Page scripts registered on an OOPIF session are inactive until its Page agent is enabled.
    // Do this while auto-attach still holds the new frame before any page script runs.
    await this.proxy.send('Page.enable', {}, sessionId);
    await this.proxy.send('Runtime.enable', {}, sessionId);
    await this.proxy.send('Page.addScriptToEvaluateOnNewDocument', { source: BROWSER_GUARD_SOURCE, worldName: BROWSER_GUARD_WORLD, runImmediately: true }, sessionId);
  }
  private async context(frameId: string, sessionId?: string): Promise<number> {
    await this.proxy.frameReady(sessionId);
    const context=this.worlds.get((sessionId??'')+'\0'+frameId);
    if(context===undefined)throw new BrowserError('BROWSER_UNAVAILABLE','页面的预先动作守卫尚未就绪');
    return context;
  }
  private frameGone(error: unknown): boolean {
    return error instanceof BrowserError && error.code === 'BROWSER_TAB_CHANGED' ||
      error instanceof Error && /no frame|cannot find frame|frame.*(?:not found|detached)|session.*(?:not found|closed)/i.test(error.message);
  }
  private async readIdentityTrees(): Promise<BrowserAXTree[]> {
    const roots: { sessionId?: string; tree: FrameTree }[] = [];
    for (const sessionId of [undefined, ...this.proxy.sessions.keys()]) {
      try {
        await this.proxy.frameReady(sessionId);
        const value = await this.proxy.send<{ frameTree: FrameTree }>('Page.getFrameTree', {}, sessionId);
        roots.push({ sessionId, tree: value.frameTree });
      } catch (error) { if (!sessionId || !this.frameGone(error)) throw error; }
    }
    const owners = new Map(roots.map(root => [root.tree.frame.id, root.sessionId]));
    const trees: BrowserAXTree[] = [], seen = new Set<string>();
    for (const root of roots) {
      await this.proxy.send('Accessibility.enable', {}, root.sessionId);
      const frames = [root.tree];
      while (frames.length) {
        const frame = frames.shift(); if (!frame) continue;
        // A cross-process child has its own debugger session and is read through that owner.
        if (owners.has(frame.frame.id) && owners.get(frame.frame.id) !== root.sessionId) continue;
        frames.push(...(frame.childFrames ?? []));
        const key = JSON.stringify([root.sessionId ?? '', frame.frame.id]);
        if (seen.has(key)) continue; seen.add(key);
        try {
          const value = await this.proxy.send<{ nodes: BrowserAXTree['nodes'] }>('Accessibility.getFullAXTree', { frameId: frame.frame.id }, root.sessionId);
          trees.push({ sessionId: root.sessionId, frameId: frame.frame.id, nodes: value.nodes });
        } catch (error) { if (!this.frameGone(error)) throw error; }
      }
    }
    return trees;
  }
  /** T1 + the exact helper responses + T2. Matching only the outside samples misses A→B→A. */
  async snapshot(helper: BrowserHelper, signal?: AbortSignal): Promise<{origin?:string;snapshot:string;refs:{ref:string;role:string;name:string;available:boolean}[]}> {
    this.invalidate();
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw signal.reason ?? new BrowserError('BROWSER_ERROR', '快照已取消');
      const epoch = this.generation, before = indexBrowserAXTrees(await this.readIdentityTrees());
      const capture = this.proxy.captureSnapshot();
      let raw: unknown;
      try { raw = await helper.command(['snapshot'], { signal }); } finally { capture.finish(); }
      const parsed = helperSnapshotSchema.safeParse(raw);
      if (!parsed.success || !capture.trees.length)
        throw new BrowserError('BROWSER_UNAVAILABLE', '固定helper未提供可核对的快照及原始无障碍树');
      const trees: BrowserAXTree[] = [];
      for (const tree of capture.trees) {
        const frameId = tree.frameId ?? tree.nodes.find(node => node.frameId)?.frameId ??
          (await this.proxy.send<{frameTree:FrameTree}>('Page.getFrameTree', {}, tree.sessionId)).frameTree.frame.id;
        trees.push({ ...tree, frameId });
      }
      const captured = indexBrowserAXTrees(trees), after = indexBrowserAXTrees(await this.readIdentityTrees());
      const candidates = new Map<string, NodeRef[]>();
      for (const node of captured.ordered) {
        const key = browserAXRoleKey(node.role, node.name), entries = candidates.get(key) ?? [];
        entries.push(node); candidates.set(key, entries);
      }
      const counts = new Map<string, number>(), mapping = new Map<string, string>();
      const refs: {ref:string;role:string;name:string;available:boolean}[] = [], bindings = new Map<string, NodeRef>();
      for (const [internal, metadata] of Object.entries(parsed.data.refs).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))) {
        const key = browserAXRoleKey(metadata.role, metadata.name), ordinal = counts.get(key) ?? 0;
        counts.set(key, ordinal + 1);
        const node = candidates.get(key)?.[ordinal], external = '@' + this.pageShort + 's' + epoch + internal;
        const stable = Boolean(node && epoch === this.generation && browserAXIdentityMatches(before, node) && browserAXIdentityMatches(after, node));
        mapping.set(internal, external);
        if (node && stable) bindings.set(external, node);
        refs.push({ ref: external, role: metadata.role, name: metadata.name, available: stable });
      }
      // Retries create fresh helper snapshots; an unstable earlier snapshot is never rebound to a later node.
      if (attempt < 2 && refs.some(ref => !ref.available)) continue;
      this.refs = bindings;
      return { origin: parsed.data.origin, snapshot: parsed.data.snapshot.replace(/ref=(e\d+)/g, (_match, id:string) => 'ref=' + (mapping.get(id) ?? id)), refs };
    }
  }
  async arm(ref: string): Promise<ArmedReference> {
    const node = this.refs.get(ref); if (!node) throw staleReference();
    try {
      const current=await this.proxy.send<{nodes:BrowserAXTree['nodes']}>('Accessibility.getFullAXTree',{frameId:node.frameId},node.sessionId);
      if(!browserAXIdentityMatches(indexBrowserAXTrees([{sessionId:node.sessionId,frameId:node.frameId,nodes:current.nodes}]),node))throw staleReference();
    }catch(error){if(this.frameGone(error))throw staleReference();throw error;}
    // Navigation or a newer snapshot can invalidate the map while the tree was being read.
    if(this.refs.get(ref)!==node)throw staleReference();
    const contextId = await this.context(node.frameId,node.sessionId);
    let resolved:{object:{objectId?:string}};
    try{resolved=await this.proxy.send('DOM.resolveNode',{backendNodeId:node.backendNodeId,executionContextId:contextId},node.sessionId);}
    catch(error){if(this.frameGone(error)||error instanceof Error&&/could not find node|no node|node.*(?:not found|detached)/i.test(error.message))throw staleReference();throw error;}
    const objectId = resolved.object.objectId; if (!objectId) throw staleReference();
    const armed = await this.proxy.send<{result:{value?:boolean};exceptionDetails?:unknown}>('Runtime.callFunctionOn',{
      objectId,functionDeclaration:'function(){return globalThis.__wyBrowserGuard?.arm(this) ?? false}',returnByValue:true,
    },node.sessionId);
    if (armed.result.value !== true) { await this.proxy.send('Runtime.releaseObject',{objectId},node.sessionId).catch(()=>{}); throw staleReference(); }
    const nonce = randomBytes(16).toString('hex');
    let hostClick: boolean;
    try {
      const location = await this.proxy.send<{result:{value?:boolean}}>('Runtime.callFunctionOn', {
        objectId, functionDeclaration: 'function(){return this.getRootNode()!==this.ownerDocument||window!==window.top}', returnByValue: true,
      }, node.sessionId);
      hostClick = location.result.value === true;
      // Apply the locator attribute to the held object, never to a role/name re-resolution.
      await this.proxy.send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(value){this.setAttribute("data-willyou-ref",value)}',arguments:[{value:nonce}]},node.sessionId);
    } catch(error) { await this.disarm(node,contextId,objectId).catch(()=>{}); throw error; }
    return {selector:`[data-willyou-ref="${nonce}"]`,node,hostClick,click:async(options={})=>{
      const check = () => { if (options.signal?.aborted) throw options.signal.reason ?? new BrowserError('BROWSER_ERROR', '点击已取消'); };
      const connected = async () => (await this.proxy.send<{result:{value?:boolean}}>('Runtime.callFunctionOn', {
        objectId, functionDeclaration:'function(){return this.isConnected&&globalThis.__wyBrowserGuard.valid()}', returnByValue:true,
      }, node.sessionId)).result.value === true;
      check();
      if (!await connected()) { options.notStarted?.(); throw staleReference(); }
      // Select this path before dispatch, never as a retry of an uncertain helper click.
      options.dispatched?.();
      await this.proxy.send('DOM.scrollIntoViewIfNeeded', {objectId}, node.sessionId);
      const geometry = await this.proxy.send<{quads:number[][]}>('DOM.getContentQuads', {objectId}, node.sessionId);
      const quad = geometry.quads.find(value => value.length === 8 && value.every(Number.isFinite));
      if (!quad) throw new BrowserError('BROWSER_ERROR', '目标没有可点击的布局区域');
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      // Hit-test through the same debugger target/viewport as Input. Resolve the hit into the
      // retained isolated world so children of a button are allowed but an overlay is not.
      const hit = await this.proxy.send<{backendNodeId:number;frameId:string}>('DOM.getNodeForLocation', {x:Math.floor(x),y:Math.floor(y),includeUserAgentShadowDOM:true}, node.sessionId);
      if (hit.frameId !== node.frameId) throw new BrowserError('BROWSER_ERROR', '点击位置被其他页面框架遮挡');
      const hitObject = await this.proxy.send<{object:{objectId?:string}}>('DOM.resolveNode', {backendNodeId:hit.backendNodeId,executionContextId:contextId}, node.sessionId);
      if (!hitObject.object.objectId) throw new BrowserError('BROWSER_ERROR', '无法核对点击位置');
      try {
        const matches = await this.proxy.send<{result:{value?:boolean}}>('Runtime.callFunctionOn', {
          objectId, functionDeclaration:'function(hit){return this.isConnected&&globalThis.__wyBrowserGuard.valid()&&(this===hit||this.contains(hit))}', arguments:[{objectId:hitObject.object.objectId}], returnByValue:true,
        }, node.sessionId);
        if (!matches.result.value) {
          if (!await connected()) throw staleReference();
          throw new BrowserError('BROWSER_ERROR', '目标被其他元素遮挡');
        }
      } finally { await this.proxy.send('Runtime.releaseObject', {objectId:hitObject.object.objectId}, node.sessionId).catch(()=>{}); }
      check();
      if (!await connected()) throw staleReference();
      await this.proxy.send('Input.dispatchMouseEvent', {type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1}, node.sessionId);
      await this.proxy.send('Input.dispatchMouseEvent', {type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1}, node.sessionId);
      check();
      return {clicked:ref,path:'cdp'};
    },fill:async(value,options={})=>{
      const check=()=>{if(options.signal?.aborted)throw options.signal.reason??new BrowserError('BROWSER_ERROR','填写已取消');};
      check(); options.dispatched?.();
      // Fixed helper fill clears .value through JS before emitting input. An event guard cannot undo that on a clone.
      // Operate on the retained object, change only its selection, then let guarded native input replace the selection.
      const selected=await this.proxy.send<{result:{value?:string};exceptionDetails?:unknown}>('Runtime.callFunctionOn',{
        objectId,functionDeclaration:`function(){
          const guard=globalThis.__wyBrowserGuard;
          if(!guard.valid()||!this.isConnected)return 'stale-before-action';
          const textInput=this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement;
          if(!textInput&&!this.isContentEditable||textInput&&(this.disabled||this.readOnly))return 'unsupported-before-action';
          this.focus();
          if(!guard.valid()||!this.isConnected)return 'stale-after-focus';
          const focused=this.getRootNode().activeElement??this.ownerDocument.activeElement;
          if(focused!==this&&!this.contains(focused))return 'focus-failed';
          if(textInput)this.select();
          else {
            const root=this.getRootNode(),selection=typeof root.getSelection==='function'?root.getSelection():this.ownerDocument.getSelection();
            if(!selection)return 'unsupported';
            const range=this.ownerDocument.createRange();range.selectNodeContents(this);selection.removeAllRanges();selection.addRange(range);
          }
          return guard.valid()&&this.isConnected?'selected':'stale-after-focus';
        }`,returnByValue:true,
      },node.sessionId);
      // A page mutation can blur its old field before this command starts. Those autonomous events
      // must not turn a proven preflight rejection into an unknown write.
      if(selected.result.value==='stale-before-action'){options.notStarted?.();throw staleReference();}
      if(selected.result.value==='unsupported-before-action'){options.notStarted?.();throw new ApplicationError('INVALID_INPUT','这个元素不能按文本框填写');}
      if(selected.result.value==='stale-after-focus')throw staleReference();
      if(selected.result.value!=='selected'||selected.exceptionDetails)throw new BrowserError('BROWSER_ERROR','这个元素不能按文本框填写');
      check();
      const valid=await this.proxy.send<{result:{value?:boolean}}>('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(){return this.isConnected&&globalThis.__wyBrowserGuard.valid()}',returnByValue:true},node.sessionId);
      if(!valid.result.value)throw staleReference();
      await this.proxy.send('Input.insertText',{text:value},node.sessionId);check();
      return {filled:ref};
    },finish:()=>this.disarm(node,contextId,objectId)};
  }
  private async disarm(node:NodeRef,contextId:number,objectId:string):Promise<GuardState> {
    try {
      const result = await this.proxy.send<{result:{value:GuardState}}>('Runtime.evaluate',{expression:'globalThis.__wyBrowserGuard.disarm()',contextId,returnByValue:true},node.sessionId);
      return result.result.value;
    } finally {
      await this.proxy.send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(){this.removeAttribute("data-willyou-ref")}'},node.sessionId).catch(()=>{});
      await this.proxy.send('Runtime.releaseObject',{objectId},node.sessionId).catch(()=>{});
    }
  }
}
