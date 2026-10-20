import { z } from 'zod';
export const BRIDGE_LIMITS = { requestBytes: 256 * 1024,responseBytes: 1024 * 1024,resourceChunkBytes: 256 * 1024,maxDepth: 32,maxNodes: 20000 } as const;
const id = z.uuid(), secret = z.string().regex(/^[a-f0-9]{64}$/);
export const bridgeCallSchema = z.object({ operation: z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9][0-9]*$/).max(128),contractMajor: z.number().int().positive(),connectionId: z.uuid().nullable(),arguments: z.record(z.string(),z.unknown()) }).strict();
export type BridgeToolCall = z.infer<typeof bridgeCallSchema>;
export const bridgeRequestSchema = z.discriminatedUnion('method',[
  z.object({ schema: z.literal(1),id,method: z.literal('exchange'),runId: id,bridgeId: id,secret }).strict(),
  z.object({ schema: z.literal(1),id,method: z.literal('renew'),token: secret }).strict(),
  z.object({ schema: z.literal(1),id,method: z.literal('tools/list'),token: secret }).strict(),
  z.object({ schema: z.literal(1),id,method: z.literal('tools/call'),token: secret,call: bridgeCallSchema }).strict(),
  z.object({ schema: z.literal(1),id,method: z.literal('cancel'),token: secret,targetId: id }).strict(),
]);
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export const bridgeBootstrapSchema = z.object({ schema: z.literal(1),endpoint: z.string().min(1).max(100),runId: id,bridgeId: id,secret,hostGeneration: id,expiresAt: z.number().int().positive() }).strict();
export type BridgeBootstrap = z.infer<typeof bridgeBootstrapSchema>;
export interface BridgeFailure { code: string;message: string;layer: 'bridge' | 'auth' | 'config' | 'provider';retryable: boolean;attemptCount: number;retryExhausted: boolean;effectState: 'not-started' | 'read-only' | 'completed' | 'unknown';nextAction: string }
export type BridgeResponse = { schema: 1;id: string;status: 'ok';value: unknown;operationId?: string;effectState?: BridgeFailure['effectState'] } | { schema: 1;id: string;status: 'error';error: BridgeFailure;operationId?: string };
export interface BridgeTool { name: string;description: string;inputSchema: { type: 'object';[key: string]: unknown };outputSchema: { type: 'object';[key: string]: unknown };annotations: { readOnlyHint: boolean;destructiveHint: boolean;idempotentHint: boolean;openWorldHint: boolean };contractMajor: number }
/** Validate iterative structure before recursive schema/hash operations. No remote refs or prototypes. */
export function boundedJson(value: unknown): boolean {
  const queue: { value: unknown;depth: number }[] = [{ value,depth: 0 }]; let nodes = 0;
  while (queue.length) {
    const current = queue.pop()!; if (++nodes > BRIDGE_LIMITS.maxNodes || current.depth > BRIDGE_LIMITS.maxDepth) return false;
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean' || (typeof current.value === 'number' && Number.isFinite(current.value))) continue;
    if (typeof current.value !== 'object' || !current.value || (!Array.isArray(current.value) && Object.getPrototypeOf(current.value) !== Object.prototype)) return false;
    if (Object.keys(current.value).some(key => ['__proto__','constructor','prototype'].includes(key))) return false;
    for (const child of Object.values(current.value)) queue.push({ value: child,depth: current.depth + 1 });
  }
  return true;
}
