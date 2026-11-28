import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { BrowserCdpProxy } from '../cdp-proxy';
import type { NativeHostVisibility } from '../park-window';

function fixture(visibility: NativeHostVisibility = 'hidden', empty = false, acquire?:()=>()=>void) {
  const png = Buffer.from('native-png'), jpeg = Buffer.from('native-jpeg');
  const image = { isEmpty: () => empty, toPNG: vi.fn(() => png), toJPEG: vi.fn(() => jpeg) };
  const capturePage = vi.fn(async () => image);
  const sendCommand = vi.fn(async () => ({ data: 'original-cdp' }));
  const contents = { isDestroyed: () => false, capturePage, debugger: { sendCommand } } as unknown as WebContents;
  const proxy = new BrowserCdpProxy(contents, undefined, () => visibility,acquire);
  return { proxy, capturePage, sendCommand, image, png, jpeg };
}

describe('viewport screenshots on hidden native hosts', () => {
  it('allows the page capturer to paint a fully hidden host without showing its native window', async () => {
    const f = fixture();
    await expect(f.proxy.send('Page.captureScreenshot', { format: 'png' })).resolves.toEqual({ data: f.png.toString('base64') });
    expect(f.capturePage).toHaveBeenCalledExactlyOnceWith(undefined, { stayHidden: false });
  });
  it('preserves the verified minimized native host capture path', async () => {
    const f = fixture('minimized');
    await expect(f.proxy.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).resolves.toEqual({ data: f.png.toString('base64') });
    expect(f.capturePage).toHaveBeenCalledExactlyOnceWith(undefined, { stayHidden: true });
    expect(f.sendCommand).not.toHaveBeenCalled();
    await expect(f.proxy.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 })).resolves.toEqual({ data: f.jpeg.toString('base64') });
    expect(f.image.toJPEG).toHaveBeenCalledExactlyOnceWith(72);
  });
  it('leaves a visible host and full-page or non-equivalent CDP options on the actual CDP path', async () => {
    const visible = fixture('visible');
    await expect(visible.proxy.send('Page.captureScreenshot', { format: 'png' })).resolves.toEqual({ data: 'original-cdp' });
    expect(visible.capturePage).not.toHaveBeenCalled();
    const hidden = fixture();
    for (const params of [{ captureBeyondViewport: true }, { clip: { x: 0, y: 0, width: 100, height: 100, scale: 1 } }, { format: 'webp' }, { fromSurface: false }, { optimizeForSpeed: true }]) {
      await expect(hidden.proxy.send('Page.captureScreenshot', params)).resolves.toEqual({ data: 'original-cdp' });
    }
    expect(hidden.capturePage).not.toHaveBeenCalled();
    expect(hidden.sendCommand).toHaveBeenCalledTimes(5);
  });
  it('rejects unavailable native images instead of publishing an empty screenshot as success', async () => {
    const f = fixture('hidden', true);
    await expect(f.proxy.send('Page.captureScreenshot', {})).rejects.toMatchObject({ code: 'BROWSER_ERROR' });
    expect(f.sendCommand).not.toHaveBeenCalled();
  });
  it('uses the actual native frame on a temporary paint host and retains its lease until native settlement after a caller timeout',async()=>{
    vi.useFakeTimers();
    try{
      const release=vi.fn(),acquire=vi.fn(()=>release),f=fixture('temporary',false,acquire);
      let settle!:(value:typeof f.image)=>void;
      f.capturePage.mockImplementationOnce(()=>new Promise(resolve=>{settle=resolve;}));
      const reply=f.proxy.send('Page.captureScreenshot',{}).catch(error=>error);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await reply).toMatchObject({code:'BROWSER_TIMEOUT'});
      expect(f.capturePage).toHaveBeenCalledWith(undefined,{stayHidden:false});expect(f.sendCommand).not.toHaveBeenCalled();
      expect(acquire).toHaveBeenCalledTimes(1);expect(release).not.toHaveBeenCalled();
      settle(f.image);await vi.advanceTimersByTimeAsync(0);expect(release).toHaveBeenCalledTimes(1);
    }finally{vi.useRealTimers();}
  });
});
