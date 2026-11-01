import { expect, it } from 'vitest';
import { builtinCapabilityDeliveryAdapters, CapabilityDeliveryAdapterRegistry } from './capability-delivery-adapters';

it('requires each CLI delivery implementation to supply its own effective sandbox probe', () => {
  const codex=builtinCapabilityDeliveryAdapters.get('codex');
  expect(typeof codex.effectiveSandbox).toBe('function');
  expect(()=>new CapabilityDeliveryAdapterRegistry([{...codex,id:'scripted-cli',runnerId:'scripted-cli',effectiveSandbox:undefined}])).toThrow('CLI入口必须提供有效沙箱核验');
});
it('an MCP-only implementation needs no CLI probe and cannot opt into an unimplemented MCP fallback', () => {
  const mcp=builtinCapabilityDeliveryAdapters.get('claude-code');
  expect(new CapabilityDeliveryAdapterRegistry([{...mcp,id:'scripted-mcp',runnerId:'scripted-mcp'}]).get('scripted-mcp').effectiveSandbox).toBeUndefined();
  expect(()=>new CapabilityDeliveryAdapterRegistry([{...mcp,id:'missing-entry',runnerId:'missing-entry',entryDelivery:()=>false}])).toThrow('已实现的入口');
});
