import { describe, expect, it, vi } from 'vitest';
import { createTerminalFitScheduler, type TerminalFitSize } from './terminal-fit';
function fixture() {
  let ready = true, size: TerminalFitSize | null = { cols: 80, rows: 24 }, serial = 0;
  const frames = new Map<number, () => void>(), cancelled: (() => void)[] = [], send = vi.fn(), measure = vi.fn(() => size);
  const scheduler = createTerminalFitScheduler({ ready: () => ready, measure, send, requestFrame: callback => { frames.set(++serial, callback); return serial; }, cancelFrame: id => { const callback = frames.get(id); if (callback) cancelled.push(callback); frames.delete(id); } });
  return { scheduler, frames, cancelled, send, measure, setReady: (value: boolean) => { ready = value; }, setSize: (value: TerminalFitSize | null) => { size = value; }, flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); } };
}
describe('terminal frame fit and PTY synchronization', () => {
  it('coalesces observer, visibility and font requests into one measurement and resize per frame', () => {
    const f = fixture(); for (let i = 0; i < 100; i++) f.scheduler.request(); expect(f.measure).not.toHaveBeenCalled();
    f.flush(); expect(f.measure).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledExactlyOnceWith({ cols: 80, rows: 24 });
  });
  it('still measures new pixel geometry but sends no repeated cell dimensions', () => {
    const f = fixture(); f.scheduler.request(); f.flush(); f.scheduler.request(); f.flush();
    expect(f.measure).toHaveBeenCalledTimes(2); expect(f.send).toHaveBeenCalledTimes(1);
    f.setSize({ cols: 81, rows: 24 }); f.scheduler.request(); f.flush(); expect(f.send).toHaveBeenLastCalledWith({ cols: 81, rows: 24 });
    f.setSize({ cols: 81, rows: 25 }); f.scheduler.request(); f.flush(); expect(f.send).toHaveBeenLastCalledWith({ cols: 81, rows: 25 });
  });
  it('measures the latest geometry at frame execution rather than queuing an obsolete size', () => {
    const f = fixture(); f.scheduler.request(); f.setSize({ cols: 120, rows: 32 }); f.scheduler.request(); f.flush(); expect(f.send).toHaveBeenCalledExactlyOnceWith({ cols: 120, rows: 32 });
  });
  it('does not fit hidden hosts and rechecks visibility after a queued frame', () => {
    const f = fixture(); f.setReady(false); f.scheduler.request(); f.flush(); expect(f.measure).not.toHaveBeenCalled();
    f.setReady(true); f.scheduler.request(); f.setReady(false); f.flush(); expect(f.measure).not.toHaveBeenCalled();
    f.setReady(true); f.scheduler.request(); f.flush(); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([null, { cols: 0, rows: 24 }, { cols: 80, rows: -1 }, { cols: 80.5, rows: 24 }, { cols: 80, rows: Number.NaN }])('never sends an invalid terminal grid (%j)', size => {
    const f = fixture(); f.setSize(size); f.scheduler.request(); f.flush(); expect(f.send).not.toHaveBeenCalled();
    f.setSize({ cols: 80, rows: 24 }); f.scheduler.request(); f.flush(); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('cancels unmounted work and ignores an already-delivered late frame', () => {
    const f = fixture(); f.scheduler.request(); f.scheduler.dispose(); expect(f.frames.size).toBe(0); f.cancelled[0]();
    f.scheduler.request(); f.flush(); expect(f.measure).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('a new PTY scheduler sends its initial size even when the old PTY had the same geometry', () => {
    const old = fixture(); old.scheduler.request(); old.flush(); old.scheduler.dispose();
    const next = fixture(); next.scheduler.request(); next.flush(); expect(next.send).toHaveBeenCalledExactlyOnceWith({ cols: 80, rows: 24 }); expect(old.send).toHaveBeenCalledTimes(1);
  });
});
