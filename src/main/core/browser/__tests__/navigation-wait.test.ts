import { EventEmitter } from 'node:events';
import {it,expect,vi} from 'vitest';
import {awaitBrowserNavigation} from '../navigation-wait';
import { BrowserPageRegistry, type BrowserPage } from '../page-registry';
it('returns actual native settlement without changing a successful value or error',async()=>{await expect(awaitBrowserNavigation(Promise.resolve('loaded'),new AbortController().signal)).resolves.toBe('loaded');const error=Error('native failure');await expect(awaitBrowserNavigation(Promise.reject(error),new AbortController().signal)).rejects.toBe(error);});
it('ends a cancelled command promptly while the native navigation can still complete for the user',async()=>{let complete!:(value:string)=>void;const finished=vi.fn(),native=new Promise<string>(resolve=>{complete=resolve;});void native.then(finished);const controller=new AbortController(),waiting=awaitBrowserNavigation(native,controller.signal),reason=Error('command budget');controller.abort(reason);await expect(waiting).rejects.toBe(reason);expect(finished).not.toHaveBeenCalled();complete('user handled prompt');await native;expect(finished).toHaveBeenCalledWith('user handled prompt');});
it('observes a late native failure even when the signal was already cancelled',async()=>{let fail!:(error:Error)=>void;const native=new Promise<never>((_resolve,reject)=>{fail=reject;}),controller=new AbortController();controller.abort(Error('closed page'));await expect(awaitBrowserNavigation(native,controller.signal)).rejects.toThrow('closed page');fail(Error('native later aborted'));await Promise.resolve();});

function pageNavigation() {
  const url = 'https://fixture.example/search?q=test';
  const redirected = url + '&redirected=1';
  const aborted = Object.assign(new Error('ERR_ABORTED (-3) loading replacement'), { code: 'ERR_ABORTED', errno: -3, url: redirected });
  let committed = 'about:blank';
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => committed,
    loadURL: vi.fn<() => Promise<void>>(),
  });
  const pages = new BrowserPageRegistry({
    userData: '/private/tmp/willyou-navigation-test',
    helper: { executable: '/must-not-run', sha256: '0'.repeat(64) },
  });
  const page = {
    abort: new AbortController(), contents, references: { invalidate: vi.fn() }, hostNavigation: null,
  } as unknown as BrowserPage;
  function start(address: string, initiator?: string) {
    contents.emit('did-start-navigation', {
      url: address, isMainFrame: true, isSameDocument: false, initiator: initiator ? { url: initiator } : null,
    });
  }
  function commit(address: string) {
    committed = address;
    contents.emit('did-navigate', {}, address, 200, 'OK');
  }
  function replace() {
    start(url);
    commit(url);
    start(redirected, url);
  }
  return { url, redirected, aborted, contents, pages, page, start, commit, replace };
}

it('returns success for a completed same-page replacement of the native load without retrying', async () => {
  const f = pageNavigation();
  f.contents.loadURL.mockImplementation(async () => { f.replace(); throw f.aborted; });
  const navigation = f.pages.navigate(f.page, f.url);
  await Promise.resolve();
  f.contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', f.url, true);
  f.commit(f.redirected);
  f.contents.emit('did-finish-load');
  await expect(navigation).resolves.toBeUndefined();
  expect(f.contents.loadURL).toHaveBeenCalledExactlyOnceWith(f.url);
});

it('retains an abort without a replacement and a failure of the replacement', async () => {
  const f = pageNavigation();
  f.contents.loadURL.mockImplementationOnce(async () => { f.start(f.url); throw f.aborted; });
  await expect(f.pages.navigate(f.page, f.url)).rejects.toBe(f.aborted);
  f.contents.loadURL.mockImplementationOnce(async () => { f.replace(); throw f.aborted; });
  const navigation = f.pages.navigate(f.page, f.url);
  await Promise.resolve();
  f.contents.emit('did-fail-load', {}, -324, 'ERR_EMPTY_RESPONSE', f.redirected, true);
  f.contents.emit('did-finish-load');
  await expect(navigation).rejects.toBe(f.aborted);
});

it('does not claim success if the replacement stopped before committing', async () => {
  const f = pageNavigation();
  f.contents.loadURL.mockImplementation(async () => { f.replace(); throw f.aborted; });
  const navigation = f.pages.navigate(f.page, f.url);
  await Promise.resolve();
  f.contents.emit('did-stop-loading');
  await expect(navigation).rejects.toBe(f.aborted);
});

it('does not follow a replacement from a previous page before the requested page commits', async () => {
  const f = pageNavigation(), previous = 'https://fixture.example/previous';
  f.commit(previous);
  f.contents.loadURL.mockImplementation(async () => {
    f.start(f.url);
    f.start(f.redirected, previous);
    throw f.aborted;
  });
  const navigation = f.pages.navigate(f.page, f.url);
  await Promise.resolve();
  f.commit(f.redirected);
  f.contents.emit('did-finish-load');
  await expect(navigation).rejects.toBe(f.aborted);
});

it('preserves caller cancellation while waiting for a replacement to finish', async () => {
  const f = pageNavigation(), caller = new AbortController();
  f.contents.loadURL.mockImplementation(async () => { f.replace(); throw f.aborted; });
  const navigation = f.pages.navigate(f.page, f.url, caller.signal);
  await Promise.resolve();
  const reason = new Error('stopped by the caller');
  caller.abort(reason);
  await expect(navigation).rejects.toBe(reason);
  expect(f.contents.eventNames()).toEqual([]);
});
