import {ApplicationError} from '@shared/applications';
import type { WebContents } from 'electron';
/** A navigation may wait on a user auth prompt indefinitely. Stop awaiting the
 * command on its budget/cancellation without discarding that user's prompt.
 * Always observe the eventual native settlement, including a late rejection. */
export function awaitBrowserNavigation<T>(navigation:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    let settled=false;const finish=(success:boolean,value:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',aborted);success?resolve(value as T):reject(value);};
    const aborted=()=>finish(false,signal.reason??new ApplicationError('CANCELED','导航等待已取消'));
    signal.addEventListener('abort',aborted,{once:true});void navigation.then(value=>finish(true,value),error=>finish(false,error));if(signal.aborted)aborted();
  });
}

/** Electron can reject the first load while a script in its newly committed
 * document replaces it. Follow the observed replacement without loading again. */
export async function loadBrowserUrl(contents: WebContents, url: string, signal: AbortSignal): Promise<void> {
  if (!/^https?:/.test(url)) return contents.loadURL(url);

  let started = false;
  let committedUrl: string | undefined;
  let replacement: {
    url: string;
    origin: string;
    committed: boolean;
    finished: Promise<boolean>;
    finish(loaded: boolean): void;
  } | undefined;
  const onStart = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (!event.isMainFrame || event.isSameDocument) return;
    if (!started) {
      started = event.url === url;
      return;
    }
    replacement?.finish(false);
    replacement = undefined;
    const source = committedUrl;
    committedUrl = undefined;
    const origin = URL.parse(event.url)?.origin;
    if (!source || event.initiator?.url !== source || !origin || origin === 'null' || origin !== URL.parse(source)?.origin) {
      started = false;
      return;
    }
    let finish!: (loaded: boolean) => void;
    const finished = new Promise<boolean>(resolve => { finish = resolve; });
    replacement = { url: event.url, origin, committed: false, finished, finish };
  };
  const onCommit = (_event: Electron.Event, address: string, status: number) => {
    if (started) committedUrl = address;
    if (replacement) replacement.committed = status >= 100 && URL.parse(address)?.origin === replacement.origin;
  };
  const onFinish = () => { if (replacement?.committed) replacement.finish(true); };
  const onFail = (_event: Electron.Event, _code: number, _description: string, address: string, main: boolean) => {
    if (main && replacement && (address === replacement.url || address === committedUrl)) replacement.finish(false);
  };
  const onStop = () => { replacement?.finish(false); };
  const cleanup = () => {
    contents.off('did-start-navigation', onStart);
    contents.off('did-navigate', onCommit);
    contents.off('did-finish-load', onFinish);
    contents.off('did-fail-load', onFail);
    contents.off('did-fail-provisional-load', onFail);
    contents.off('did-stop-loading', onStop);
    contents.off('destroyed', onStop);
    signal.removeEventListener('abort', cleanup);
  };
  contents.on('did-start-navigation', onStart);
  contents.on('did-navigate', onCommit);
  contents.on('did-finish-load', onFinish);
  contents.on('did-fail-load', onFail);
  contents.on('did-fail-provisional-load', onFail);
  contents.on('did-stop-loading', onStop);
  contents.on('destroyed', onStop);
  signal.addEventListener('abort', cleanup, { once: true });
  try {
    await contents.loadURL(url);
  } catch (error) {
    const next = replacement;
    if (signal.aborted || !next || !(error instanceof Error) || !('code' in error) || error.code !== 'ERR_ABORTED'
      || !('url' in error) || error.url !== next.url || !await awaitBrowserNavigation(next.finished, signal)) throw error;
  } finally {
    cleanup();
  }
}
