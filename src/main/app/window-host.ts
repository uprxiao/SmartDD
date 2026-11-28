import type { BaseWindow, WebContents, WebContentsView } from 'electron';

/** The native parent and its trusted application contents have different identities.
 * This module deliberately has no runtime Electron/UI imports. */
interface MainHost {
  window: BaseWindow;
  shell: WebContentsView;
  contents: WebContents;
  generation: number;
  documentGeneration: number;
}
export interface MainShellChange {
  window: BaseWindow;
  contents: WebContents;
  generation: number;
  documentGeneration: number;
  reason: 'navigation' | 'renderer-gone' | 'shell-replaced' | 'host-closed';
}

let host: MainHost | null = null;
let serial = 0;
const observers = new Set<(change: MainShellChange) => void>();

export function bindMainHost(window: BaseWindow, shell: WebContentsView): void {
  if (host && !host.window.isDestroyed()) throw new Error('Main window is already bound');
  host = { window, shell, contents:shell.webContents, generation: ++serial, documentGeneration: 0 };
}

/** Rebind only the trusted shell while preserving the native window and owned page views. */
export function replaceMainShell(window:BaseWindow,shell:WebContentsView):void{
  const current=host;
  if(!current||current.window!==window||window.isDestroyed())throw new Error('Main window is no longer bound');
  invalidateMainShell(current.contents,'shell-replaced');
  if(window.contentView.children.includes(current.shell))window.contentView.removeChildView(current.shell);
  host={window,shell,contents:shell.webContents,generation:current.generation,documentGeneration:current.documentGeneration};
  if(!current.contents.isDestroyed())current.contents.close({waitForBeforeUnload:false});
}

export function invalidateMainShell(contents: WebContents, reason: MainShellChange['reason']): boolean {
  const current = host;
  if (!current || current.contents !== contents) return false;
  releaseNativeFront(current.window);
  nativeBlocks.delete(current.window);
  const change = { window: current.window, contents, generation: current.generation, documentGeneration: ++current.documentGeneration, reason };
  for (const observer of observers) {
    try { observer(change); } catch (error) { console.warn('[main-window] shell invalidation observer failed', error instanceof Error ? error.name : 'Error'); }
  }
  return true;
}

export function observeMainShell(listener: (change: MainShellChange) => void): () => void {
  observers.add(listener);
  return () => { observers.delete(listener); };
}

export function clearMainHost(window: BaseWindow): boolean {
  if (!host || host.window !== window) return false;
  const closing=host.contents;
  invalidateMainShell(closing, 'host-closed');
  host = null;
  if(!closing.isDestroyed())closing.close({waitForBeforeUnload:false});
  return true;
}

export function getMainWindow(): BaseWindow | null {
  return host && !host.window.isDestroyed() ? host.window : null;
}

export function getMainShell(): WebContentsView | null {
  return getMainWindow() && host && !host.contents.isDestroyed() ? host.shell : null;
}

export function getMainWindowContents(): WebContents | null {
  return getMainShell() ? host!.contents : null;
}

export function mainWindowForContents(contents: WebContents): BaseWindow | null {
  return getMainWindowContents() === contents ? getMainWindow() : null;
}

export function getMainShellIdentity(): { host: number; document: number } | null {
  return getMainShell() && host ? { host: host.generation, document: host.documentGeneration } : null;
}

/** One native content slot per root. A view can remain attached behind the
 * shell while its foreground responsibility is revoked. */
type NativeFront={view:WebContentsView;contents:WebContents;demote:()=>void;promote:()=>void;canPresent?:()=>boolean};
const nativeFronts=new WeakMap<BaseWindow,NativeFront>();
const nativeBlocks=new WeakMap<BaseWindow,Set<string>>();
function promoteFront(window:BaseWindow,front:NativeFront){if(window.isDestroyed()||front.contents.isDestroyed()||front.canPresent?.()===false)return false;window.contentView.addChildView(front.view);front.promote();return true;}
export function claimNativeFront(window:BaseWindow,view:WebContentsView,demote:()=>void,promote=()=>view.setVisible(true),canPresent?:()=>boolean):boolean{
  const contents=view.webContents;if(window.isDestroyed()||!contents||contents.isDestroyed())return false;
  const old=nativeFronts.get(window);if(old&&old.view!==view){nativeFronts.delete(window);old.demote();}
  const front={view,contents,demote,promote,canPresent};nativeFronts.set(window,front);
  if(nativeBlocks.get(window)?.size){demote();return false;}
  return promoteFront(window,front);
}
/** A deferred native view may become presentable after its independent paint
 * owners settle. Only refresh the still-current, unblocked front slot. */
export function refreshNativeFront(window:BaseWindow,view:WebContentsView):void{
  const front=nativeFronts.get(window);if(front?.view===view&&!nativeBlocks.get(window)?.size)promoteFront(window,front);
}
export function releaseNativeFront(window:BaseWindow,view?:WebContentsView):void{
  const old=nativeFronts.get(window);if(!old||view&&old.view!==view)return;nativeFronts.delete(window);old.demote();
}
/** Block the native slot before rendering a shell menu. Any layout submitted
 * while blocked only records desired ownership, never covers the menu. */
export function setNativeOverlay(window:BaseWindow,owner:string,open:boolean):void{
  const holds=nativeBlocks.get(window)??new Set<string>();const wasBlocked=holds.size>0;
  if(open)holds.add(owner);else holds.delete(owner);
  if(holds.size)nativeBlocks.set(window,holds);else nativeBlocks.delete(window);
  const desired=nativeFronts.get(window);if(!desired)return;
  if(!wasBlocked&&holds.size)desired.demote();else if(wasBlocked&&!holds.size)promoteFront(window,desired);
}
