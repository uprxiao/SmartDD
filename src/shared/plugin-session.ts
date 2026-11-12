import {z} from 'zod';
import {pluginManifestSchema} from './plugins';

/** Discovery is fixed at launch; the package hash is an audit identity, not a version lock. */
export const pluginCapabilityIdSchema = pluginManifestSchema.shape.capabilities.keyType;
// Keep the pre-M13 invocation length budget for existing builtins while allowing plugin identifiers.
export const applicationInvocationIdSchema=z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){1,7}$/).max(192);
export const pluginSessionSelectionSchema = z.object({
  appId: pluginManifestSchema.shape.id,
  packageHash: z.string().regex(/^[a-f0-9]{64}$/),
  version: pluginManifestSchema.shape.version,
  entry: z.enum(['mcp','cli']),
  bindingRevision: z.number().int().nonnegative().optional(),
  capabilities: z.array(z.object({
    id: pluginCapabilityIdSchema,
    permission: pluginCapabilityIdSchema,
    semantics: z.enum(['read','write','external-write']),
    slots: z.array(pluginManifestSchema.shape.id).max(32),
    mcpTool: z.string().regex(/^smartdd_[a-z0-9_]+_v1$/).max(128),
    aliases: z.array(z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9][0-9]*$/).max(128)).max(32),
  }).strict()).max(256),
  connections: z.array(z.object({
    slot: pluginManifestSchema.shape.id, connectionId: z.uuid(),
    identityRevision: z.number().int().positive(),
  }).strict()).max(32),
}).strict().superRefine((value,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(new Set(value.capabilities.map(c=>c.id)).size!==value.capabilities.length || new Set(value.connections.map(c=>c.slot)).size!==value.connections.length)fail('插件能力或连接槽重复');
  const names=value.capabilities.flatMap(c=>[c.mcpTool,...c.aliases]);
  if(new Set(names).size!==names.length)fail('插件工具名称重复');
  for(const cap of value.capabilities){
    if(!cap.id.startsWith(value.appId+'.') || !cap.permission.startsWith(value.appId+'.') || new Set(cap.slots).size!==cap.slots.length)fail('插件能力范围无效');
  }
});
export type PluginSessionSelection=z.infer<typeof pluginSessionSelectionSchema>;
/** Host-issued scope, outside plugin input. Plugins cannot choose a project/run by accepting model arguments. */
export const pluginExecutionScopeSchema=z.object({projectId:z.string().min(1).max(200),operationId:z.uuid(),callerKind:z.enum(['ui','agent']),runId:z.string().min(1).max(200).optional()}).strict();
export type PluginExecutionScope=z.infer<typeof pluginExecutionScopeSchema>;
/** Errors are identifiers only. Untrusted remote messages/credentials are never forwarded to the UI. */
export const pluginBusinessErrorSchema=z.enum(['AUTH_FAILED','AUTH_REQUIRED','IDENTITY_CHANGE_REQUIRES_SELECTION','SCOPE_DENIED','NOT_FOUND','INVALID_INPUT','INVALID_RESPONSE','HASH_MISMATCH','SOURCE_UNAVAILABLE','INCOMPLETE_RESULT','TOO_LARGE','TIMEOUT','CONNECTION_UNAVAILABLE','TRANSIENT_FAILURE','SERVICE_ADDRESS_MISMATCH','REVISION_CONFLICT']);

/** The host wraps raw plugin values; native CLI clients never infer success from arbitrary plugin JSON. */
export const pluginCliResultSchema=z.object({
  schema:z.literal('willyou-plugin-result-v1'),capabilityId:pluginCapabilityIdSchema,contractMajor:z.literal(1),data:z.unknown(),
  operation:z.object({id:z.uuid(),requestId:z.uuid(),effectState:z.enum(['read-only','completed','unknown'])}).strict(),
}).strict();
