import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import type { WebContents } from 'electron';
import { WebSocket } from 'ws';
import { BrowserCdpProxy } from '../cdp-proxy';

class Debugger extends EventEmitter {
  attached = false;
  calls: { method: string; params: unknown; sessionId?: string }[] = [];
  attach() { this.attached = true; }
  detach() { this.attached = false; }
  isAttached() { return this.attached; }
  async sendCommand(method: string, params: unknown, sessionId?: string) { this.calls.push({ method, params, sessionId }); return { value: 'page-only' }; }
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); });
async function fixture() {
  const debugger_ = new Debugger();
  const proxy = new BrowserCdpProxy({ debugger: debugger_, isDestroyed: () => false, getTitle: () => 'private-page', getURL: () => 'https://private.test/' } as unknown as WebContents);
  await proxy.start(); cleanups.push(() => proxy.stop());
  const socket = new WebSocket(proxy.endpoint); await once(socket,'open');
  let id = 0;
  const call = (method: string, params: unknown = {}, sessionId?: string): Promise<Record<string, any>> => new Promise((resolve, reject) => {
    const key = ++id, timeout = setTimeout(() => reject(Error('no CDP response')),2000);
    const receive = (raw: WebSocket.RawData) => { const value = JSON.parse(String(raw)); if (value.id === key) { clearTimeout(timeout); socket.off('message',receive); resolve(value); } };
    socket.on('message',receive); socket.send(JSON.stringify({ id:key,method,params,...(sessionId ? {sessionId}: {}) }));
  });
  return { proxy, debugger_, socket, call };
}

describe('S1 per-page CDP proxy over real loopback/WebSocket', () => {
  it('preserves the fixed helper direct-page event scope without admitting foreign events', async () => {
    const { debugger_, socket } = await fixture();
    const event = once(socket, 'message');
    debugger_.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log', args: [] }, '');
    expect(JSON.parse(String((await event)[0]))).toEqual({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [] }, sessionId: '' });
  });
  it('advertises only its page and requires the capability URL for HTTP and upgrades', async () => {
    const { proxy, call } = await fixture();
    const list = await (await fetch(proxy.discoveryEndpoint+'/json/list')).json();
    expect(list).toHaveLength(1); expect(list[0].title).toBe('private-page');
    expect((await fetch(proxy.discoveryEndpoint.replace(/\/[a-f0-9]+$/,'')+'/json/list')).status).toBe(404);
    expect((await fetch(proxy.discoveryEndpoint+'/json/list',{ headers:{ Origin:'https://hostile.test' } })).status).toBe(403);
    expect((await call('Target.getTargets')).result.targetInfos).toHaveLength(1);
  });
  it('rejects app-global operations, forged targets and forged sessions without forwarding', async () => {
    const { call, debugger_ } = await fixture();
    const before = debugger_.calls.length;
    for (const method of ['Target.createTarget','Target.setDiscoverTargets','Browser.close','Browser.setDownloadBehavior','Storage.getCookies','SystemInfo.getInfo','Target.closeTarget'])
      expect((await call(method,{ targetId:'foreign' })).error).toBeTruthy();
    expect((await call('Target.attachToTarget',{ targetId:'foreign' })).error).toBeTruthy();
    expect((await call('Runtime.evaluate',{ expression:'1' },'forged-session')).error).toBeTruthy();
    expect(debugger_.calls).toHaveLength(before);
  });
  it('translates a client root session and only accepts iframe sessions attached by its own debugger', async () => {
    const { call, debugger_, socket } = await fixture();
    const target = (await call('Target.getTargets')).result.targetInfos[0];
    const session = (await call('Target.attachToTarget',{ targetId:target.targetId,flatten:true })).result.sessionId;
    expect((await call('Runtime.evaluate',{ expression:'1' },session)).result).toEqual({ value:'page-only' });
    expect(debugger_.calls.at(-1)?.sessionId).toBeUndefined();
    debugger_.emit('message',{},'Target.attachedToTarget',{ sessionId:'own-frame',targetInfo:{ targetId:'frame-target',type:'iframe' },waitingForDebugger:false },'');
    expect((await call('Runtime.evaluate',{ expression:'2' },'own-frame')).result).toBeTruthy();
    expect(debugger_.calls.at(-1)?.sessionId).toBe('own-frame');
    await call('Page.bringToFront',{},session);
    expect(debugger_.calls.at(-1)?.method).toBe('Runtime.evaluate');
    socket.close();
  });
});
