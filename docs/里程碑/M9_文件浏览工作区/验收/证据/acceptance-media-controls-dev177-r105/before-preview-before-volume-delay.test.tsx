// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileBuffer } from '../file-buffer';
import { FileMediaPreview } from './preview';

const api = vi.hoisted(() => ({ openMedia: vi.fn(), mediaChunk: vi.fn(), releaseMedia: vi.fn(async () => undefined), copy: vi.fn(async () => ({ state: 'cancelled' })) }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
vi.mock('../file-actions', () => ({ saveFileCopy: api.copy }));

type State = { paused: boolean; ended: boolean; duration: number; currentTime: number; volume: number; muted: boolean; playbackRate: number; readyState: number; error: { code: number } | null };
let states: WeakMap<HTMLMediaElement, State>;
const state = (node: HTMLMediaElement) => {
  let value = states.get(node);
  if (!value) { value = { paused: true, ended: false, duration: NaN, currentTime: 0, volume: 1, muted: false, playbackRate: 1, readyState: 0, error: null }; states.set(node, value); }
  return value;
};
const original = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  states = new WeakMap(); vi.clearAllMocks();
  for (const key of ['paused', 'ended', 'duration', 'currentTime', 'volume', 'muted', 'playbackRate', 'readyState', 'error'] as const) {
    original.set(key, Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, key));
    Object.defineProperty(HTMLMediaElement.prototype, key, { configurable: true, get() { return state(this)[key]; }, set(value) { Object.assign(state(this), { [key]: value }); if (key === 'volume' || key === 'muted') this.dispatchEvent(new Event('volumechange')); if (key === 'playbackRate') this.dispatchEvent(new Event('ratechange')); } });
  }
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { state(this).paused = true; this.dispatchEvent(new Event('pause')); });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) { state(this).paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); });
  api.openMedia.mockImplementation(async (input) => ({ id: input.id, transport: 'protocol', mime: 'video/mp4', size: 16, hash: 'a'.repeat(64), url: `willyou-media://local/${'b'.repeat(64)}` }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); for (const [key, descriptor] of original) if (descriptor) Object.defineProperty(HTMLMediaElement.prototype, key, descriptor); original.clear(); });
const buffer = (name = 'video.mp4') => ({ file: { ref: { id: 'aa78bd82-b830-443f-8b7d-54e2b39f4de6', lease: 'b9924dcc-d93f-433d-b658-6af969d55c2d', generation: 1 }, name, absolutePath: `/fixture/${name}`, revision: { size: 16, hash: 'a'.repeat(64) } } }) as FileBuffer;
async function ready(kind = 'video') {
  const node = document.querySelector(kind)! as HTMLMediaElement;
  await waitFor(() => expect(node.getAttribute('src')).toContain('willyou-media:'));
  if (kind === 'video') {
    Object.defineProperty(node, 'videoWidth', { configurable: true, value: 320 });
    Object.defineProperty(node, 'videoHeight', { configurable: true, value: 180 });
  }
  act(() => { Object.assign(state(node), { duration: 12, readyState: 4 }); node.dispatchEvent(new Event('loadedmetadata')); node.dispatchEvent(new Event('canplay')); });
  return node;
}
describe('media player user interactions (decoder isolated)', () => {
  it('rejects an undecodable video track even when its supported audio track reaches canplay', async () => {
    render(<FileMediaPreview buffer={buffer()} />);
    const node = document.querySelector('video')!;
    await waitFor(() => expect(node.getAttribute('src')).toContain('willyou-media:'));
    act(() => {
      Object.assign(state(node), { duration: 8, readyState: 4, paused: false });
      node.dispatchEvent(new Event('canplay'));
    });
    expect(screen.getByRole('alert').textContent).toContain('视频编码');
    expect((screen.getByRole('button', { name: '播放' }) as HTMLButtonElement).disabled).toBe(true);
    expect(node.paused).toBe(true); expect(node.getAttribute('src')).toBeNull();
    expect(api.releaseMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '重新读取' })).toBeTruthy();
  });
  it('provides an audio card with synchronized controls, no native controls or video extras', async () => {
    render(<FileMediaPreview buffer={buffer('sound.wav')} />);
    expect((screen.getByRole('button', { name: '播放' }) as HTMLButtonElement).disabled).toBe(true);
    const node = await ready('audio'); expect(node.hidden).toBe(true); expect(node.controls).toBe(false);
    expect(screen.queryByLabelText('视频音量')).toBeNull(); expect(screen.queryByLabelText('全屏')).toBeNull();
    const seek = screen.getByRole('slider', { name: '播放进度' }) as HTMLInputElement; expect(seek.step).toBe('0.1');
    fireEvent.click(screen.getByRole('button', { name: '播放' })); await screen.findByRole('button', { name: '暂停' });
    fireEvent.change(seek, { target: { value: '4.5' } }); expect(node.currentTime).toBe(4.5); expect(screen.getByText('0:04 / 0:12')).toBeTruthy();
    act(() => { Object.assign(state(node), { ended: true, paused: true, currentTime: 12 }); node.dispatchEvent(new Event('ended')); });
    expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
  });
  it('keeps video controls visible, toggles once for Space/Enter and ignores repeats/IME', async () => {
    render(<FileMediaPreview buffer={buffer()} />); const node = await ready();
    expect(node.controls).toBe(false);
    fireEvent.keyDown(node, { key: ' ', repeat: false }); await screen.findByRole('button', { name: '暂停' });
    fireEvent.keyDown(node, { key: ' ', repeat: true }); expect(node.paused).toBe(false);
    fireEvent.keyDown(node, { key: 'Enter', isComposing: true }); expect(node.paused).toBe(false);
    fireEvent.keyDown(node, { key: 'Enter' }); expect(node.paused).toBe(true);
    fireEvent.keyDown(document.body, { key: ' ' }); expect(node.paused).toBe(true);
    expect(screen.queryByText('复制链接')).toBeNull(); expect(screen.getByLabelText('媒体菜单')).toBeTruthy();
  });
  it('resumes a playing seek once for up/cancel/lost-capture and keeps paused seeks paused', async () => {
    render(<FileMediaPreview buffer={buffer()} />); const node = await ready();
    const seek = screen.getByRole('slider', { name: '播放进度' });
    Object.defineProperty(seek, 'setPointerCapture', { configurable: true, value: vi.fn() });
    const pointer = (type: string, id: number) => fireEvent(seek, Object.assign(new MouseEvent(type, { bubbles: true, button: 0 }), { pointerId: id }));
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      act(() => { state(node).paused = false; node.dispatchEvent(new Event('play')); });
      const before = play.mock.calls.length;
      pointer('pointerdown', 7); expect(node.paused).toBe(true);
      pointer(ending, 7); await waitFor(() => expect(node.paused).toBe(false));
      pointer('pointerup', 7); pointer('lostpointercapture', 7);
      expect(play.mock.calls.length - before).toBe(1);
      act(() => { state(node).paused = true; node.dispatchEvent(new Event('pause')); });
      pointer('pointerdown', 8); pointer(ending, 8);
      expect(node.paused).toBe(true); expect(play.mock.calls.length - before).toBe(1);
    }
  });
  it('does not expose source-less Save, reports decoder failure, and retries with a new capability', async () => {
    render(<FileMediaPreview buffer={buffer()} />); const node = await ready();
    act(() => { state(node).error = { code: 3 }; node.dispatchEvent(new Event('error')); });
    expect(screen.getByRole('alert').textContent).toContain('解码失败'); expect(node.getAttribute('src')).toBeNull(); expect(api.releaseMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新读取' })); await ready();
    expect(api.openMedia).toHaveBeenCalledTimes(2); expect(api.openMedia.mock.calls[0][0].id).not.toBe(api.openMedia.mock.calls[1][0].id);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('normalizes invalid duration and releases the playing element on unmount', async () => {
    const view = render(<FileMediaPreview buffer={buffer()} />), node = await ready();
    act(() => { state(node).duration = Infinity; node.dispatchEvent(new Event('durationchange')); });
    expect((screen.getByLabelText('播放进度') as HTMLInputElement).disabled).toBe(true); expect(screen.getByText('0:00 / 0:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '播放' })); await screen.findByRole('button', { name: '暂停' });
    view.unmount(); expect(node.paused).toBe(true); expect(node.getAttribute('src')).toBeNull(); expect(api.releaseMedia).toHaveBeenCalledTimes(1);
  });
  it.each([['zero', 0], ['NaN', NaN], ['Infinity', Infinity]] as const)('T19 audio metadata integration: %s disables seek, stays finite and recovers when metadata becomes finite', async (_label, duration) => {
    // Controlled decoder component check (U), not native RPC/I or an App event.
    render(<FileMediaPreview buffer={buffer('audio.wav')} />);
    const node = await ready('audio');
    act(() => { state(node).duration = duration; node.dispatchEvent(new Event('durationchange')); });
    const seek = screen.getByLabelText('播放进度') as HTMLInputElement;
    expect(seek.disabled).toBe(true); expect(seek.max).toBe('0');
    expect(screen.getByText('0:00 / 0:00')).toBeTruthy();
    expect(document.querySelector('.fw-media-time')?.textContent).not.toMatch(/NaN|Infinity/);
    act(() => { state(node).duration = 3; node.dispatchEvent(new Event('durationchange')); });
    expect(seek.disabled).toBe(false); expect(seek.max).toBe('3');
    expect(screen.getByText('0:00 / 0:03')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('ends an indefinite loading state after 15 seconds and cancels the capability', async () => {
    vi.useFakeTimers(); render(<FileMediaPreview buffer={buffer()} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole('alert').textContent).toContain('加载超时'); expect(api.releaseMedia).toHaveBeenCalledTimes(1);
  });
  it('T24 keeps the below-player controls present after the overlay timeout boundary',async()=>{render(<FileMediaPreview buffer={buffer()}/>);const node=await ready();fireEvent.click(screen.getByRole('button',{name:'播放'}));await screen.findByRole('button',{name:'暂停'});vi.useFakeTimers();await act(async()=>vi.advanceTimersByTimeAsync(3100));expect(node.controls).toBe(false);expect(document.querySelector('.fw-media-controls')).toBeTruthy();expect(screen.getByRole('button',{name:'暂停'})).toBeTruthy();expect(screen.queryByText('复制链接')).toBeNull();});
  it('T28 synchronizes volume/mute/icons, preserves the popover value, and resets a different file',async()=>{const f=render(<FileMediaPreview buffer={buffer()}/>);const node=await ready();fireEvent.click(screen.getByLabelText('视频音量'));const slider=screen.getByLabelText('音量')as HTMLInputElement;expect([slider.min,slider.max,slider.step]).toEqual(['0','1','0.01']);for(const volume of[0,.5,1]){fireEvent.change(slider,{target:{value:String(volume)}});expect(node.volume).toBe(volume);expect(node.muted).toBe(false);expect(!!screen.getByLabelText('视频音量').querySelector('.lucide-volume-x')).toBe(volume===0);}fireEvent.click(screen.getByLabelText('静音'));expect(node.muted).toBe(true);fireEvent.change(slider,{target:{value:'.01'}});expect(node.volume).toBe(.01);expect(node.muted).toBe(false);fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});fireEvent.click(screen.getByLabelText('视频音量'));expect((screen.getByLabelText('音量')as HTMLInputElement).value).toBe('0.01');fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});const next=buffer('next.mp4');next.file.ref.id='aa78bd82-b830-443f-8b7d-54e2b39f4de7';f.rerender(<FileMediaPreview buffer={next}/>);await ready();expect(node.volume).toBe(1);expect(node.muted).toBe(false);});
  it('T29 applies every media rate and reflects exactly one checked radio item',async()=>{render(<FileMediaPreview buffer={buffer()}/>);const node=await ready(),rates=[.25,.5,.75,1,1.25,1.5,1.75,2];for(const rate of rates){fireEvent.click(screen.getByLabelText('媒体菜单'));expect(screen.getAllByRole('menuitemradio').map(e=>e.textContent?.trim())).toEqual(rates.map(x=>x+'×'));fireEvent.click(screen.getByRole('menuitemradio',{name:rate+'×'}));expect(node.playbackRate).toBe(rate);expect(screen.getByRole('menuitemradio',{name:rate+'×'}).getAttribute('aria-checked')).toBe('true');expect(screen.getAllByRole('menuitemradio').filter(e=>e.getAttribute('aria-checked')==='true')).toHaveLength(1);fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});}});

});
