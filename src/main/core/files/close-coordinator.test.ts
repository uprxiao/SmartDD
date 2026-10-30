import { afterEach, expect, it, vi } from 'vitest';
import { FileCloseCoordinator } from './close-coordinator';
import type { FileCloseRequest } from '@shared/files';

afterEach(() => vi.useRealTimers());
it('requires an answer from the original frame and rejects replayed receipts', async () => {
  const coordinator = new FileCloseCoordinator();
  let request!: FileCloseRequest;
  const pending = coordinator.request('window:frame', 'save', (value) => { request = value; });
  const reply = { id: request.id, ready: true, failures: [] };
  expect(() => coordinator.answer('other:frame', reply)).toThrow('不属于');
  coordinator.answer('window:frame', reply);
  expect(await pending).toEqual(reply);
  expect(() => coordinator.answer('window:frame', reply)).toThrow('已过期');
});
it('does not confirm quit with remaining failures or a timed-out renderer', async () => {
  vi.useFakeTimers();
  const coordinator = new FileCloseCoordinator(); let request!: FileCloseRequest;
  const pending = coordinator.request('owner', 'discard', (value) => { request = value; });
  expect(() => coordinator.answer('owner', { id: request.id, ready: true, failures: [{ name: 'a', message: 'failed' }] })).toThrow('未解决');
  await vi.advanceTimersByTimeAsync(30000);
  expect((await pending).ready).toBe(false);
  expect(() => coordinator.answer('owner', { id: request.id, ready: true, failures: [] })).toThrow('已过期');
});
it('fails pending commit when the original renderer closes', async () => {
  const coordinator = new FileCloseCoordinator();
  const pending = coordinator.request('owner', 'commit', () => undefined);
  coordinator.closeOwner('owner');
  expect(await pending).toMatchObject({ ready: false, failures: [{ message: expect.stringContaining('重新载入') }] });
});
it('fails immediately if the message cannot be sent', async () => {
  const coordinator = new FileCloseCoordinator();
  expect(await coordinator.request('owner', 'save', () => { throw new Error('destroyed'); })).toMatchObject({ ready: false });
});
