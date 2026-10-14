import { describe, expect, it, vi } from 'vitest';
import { createRPCClient, createRPCController, createRPCRouter, registerRPCRouter, rpcErrorMessage } from './rpc';

const router = createRPCRouter({
  math: createRPCController({ add: async (a: number, b: number) => a + b }),
});

describe('rpc', () => {
  it('registers each method as a namespaced channel that drops the IPC event', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerRPCRouter(router, { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) } as never);
    expect([...handlers.keys()]).toEqual(['math.add']);
    await expect(handlers.get('math.add')!({ sender: {} }, 2, 3)).resolves.toBe(5);
  });

  it('client invokes the namespaced channel with the arguments', async () => {
    const invoke = vi.fn(async () => 7);
    const client = createRPCClient<typeof router>(invoke);
    await expect(client.math.add(3, 4)).resolves.toBe(7);
    expect(invoke).toHaveBeenCalledWith('math.add', 3, 4);
  });

  it('client proxies are not thenable, so awaiting them does not hang or invoke', async () => {
    const invoke = vi.fn();
    const client = createRPCClient<typeof router>(invoke);
    expect((client as unknown as { then?: unknown }).then).toBeUndefined();
    expect((client.math as unknown as { then?: unknown }).then).toBeUndefined();
    await Promise.resolve(client.math);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rpcErrorMessage strips the Electron invoke prefix', () => {
    expect(rpcErrorMessage(new Error("Error invoking remote method 'appSettings.update': Error: 设置无效"))).toBe('设置无效');
    expect(rpcErrorMessage(new Error('plain'))).toBe('plain');
    expect(rpcErrorMessage('str')).toBe('str');
  });
});
