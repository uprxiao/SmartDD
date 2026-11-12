import {z} from 'zod';
import {isPackagePath} from './applications';

export const PLUGIN_PROTOCOL = 'jsonrpc-stdio/1';
export const PLUGIN_HOST_API = 1;
export const PLUGIN_MANIFEST_PATH = '.willyou-plugin/plugin.json';
export const PLUGIN_LIMITS = Object.freeze({
  files: 4096, fileBytes: 64 * 1024 * 1024, packageBytes: 256 * 1024 * 1024,
  manifestBytes: 256 * 1024, schemaBytes: 256 * 1024, depth: 32,
  frameBytes: 256 * 1024, outputBytes: 4 * 1024 * 1024,
  concurrentCalls: 4, hostProcesses: 16, processesPerPlugin: 2, childProcesses: 0,
  handshakeMs: 5000, executeMs: 30000,
});

const text = z.string().min(1).max(4000);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const safeSegment = (part: string) => !['__proto__', 'prototype', 'constructor'].includes(part);
export const isPluginFieldPath = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value) && value.split('.').every(safeSegment);
const field = z.string().max(512).refine(isPluginFieldPath);
const path = z.string().refine(isPackagePath);
const directory = z.string().refine(value => isPackagePath(value.endsWith('/') ? value.slice(0, -1) : value));
const capabilityId = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){1,7}$/).max(128);
const jsonSchema = z.record(z.string(), z.unknown());
const partial = z.object({completeField: field, problemsField: field.optional(), missingField: field.optional()}).strict();
const source = z.object({
  capability: capabilityId, input: z.record(z.string(), z.unknown()).optional(), items: field.optional(),
  pagination: z.object({type: z.literal('cursor'), inputField: field, nextField: field, pageSize: z.number().int().min(1).max(1000)}).strict().optional(),
  partial: partial.optional(), presentationField: field.optional(),
}).strict();
const action = z.object({
  kind: z.enum(['insertTerminal', 'openUrl']), title: text,
  payload: z.record(z.string(), z.unknown()).optional(), field: field.optional(), closeOnDone: z.boolean().optional(),
}).strict();
const section = z.object({
  kind: z.enum(['fields', 'resource', 'resourceList']), from: field, title: text.optional(),
  labels: field.optional(), enums: field.optional(), read: capabilityId.optional(),
  render: z.literal('markdown-or-text').optional(), nameField: field.optional(), resourceField: field.optional(),
  preview: z.array(z.string().max(128)).max(32).optional(),
}).strict();
const detail = z.object({titleTemplate: text, source, sections: z.array(section).max(64), actions: z.array(action).max(32).default([])}).strict();
export const pluginPanelSchema = z.object({
  id, title: text, subtitle: text.optional(), kind: z.literal('list'), refresh: z.boolean().optional(),
  requires: z.object({projectConnection: id, emptyAction: z.literal('projectSelection')}).strict().optional(),
  tabs: z.array(z.object({id, title: text, input: z.record(z.string(), z.unknown())}).strict()).max(32).default([]),
  source, rowKey: field,
  columns: z.array(z.object({field, title: text, width: z.number().min(16).max(2000).optional(), enum: field.optional(), format: z.enum(['text', 'badge', 'datetime']).optional()}).strict()).min(1).max(64),
  onRowOpen: z.object({detail: id}).strict().optional(),
  details: z.record(id, detail).default({}), rowActions: z.array(action).max(32).default([]),
}).strict();

export const pluginManifestSchema = z.object({
  schema: z.literal('willyou-plugin/v0-draft2'), id,
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  hostApi: z.union([z.number().int().positive(), z.string().min(1).max(64)]),
  displayName: z.string().trim().min(1).max(120), description: z.string().max(4000),
  author: z.object({name: text, url: z.url().optional()}).strict().optional(),
  icon: z.object({light: path, dark: path}).strict().optional(),
  category: text.optional(), homepage: z.url().optional(), repository: z.url().optional(), license: text.optional(),
  examples: z.array(z.object({title: text, prompt: text}).strict()).max(32).default([]),
  permissions: z.array(z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/)).max(128),
  schemas: z.array(path).max(128).default([]),
  providers: z.array(z.object({
    id, displayName: text, config: jsonSchema,
    secret: z.object({title: text, required: z.boolean().optional(), modes: z.array(id).min(1).max(16).optional()}).strict().optional(),
    summaryFields: z.array(field).max(32).default([]),
  }).strict()).max(32).default([]),
  projectPolicy: z.object({connectionsPerProject: z.literal(1), note: text.optional()}).strict().optional(),
  capabilities: z.record(capabilityId, z.object({
    title: text, permission: capabilityId, semantics: z.enum(['read', 'write', 'external-write']),
    retry: z.enum(['safe-read', 'never']), slots: z.array(id).max(32),
    input: path, output: path, agentVisible: z.boolean().optional(),
  }).strict()),
  legacyToolNames: z.record(z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/), capabilityId).default({}),
  legacyToolContracts: z.record(z.string().regex(/^smartdd_[a-z0-9_]+_v2$/), z.object({input:path,output:path,result:z.literal('application-v2'),dataFields:z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine(safeSegment)).max(128).optional()}).strict()).optional(),
  runtime: z.object({type: z.literal('process'), entry: path, protocol: z.literal(PLUGIN_PROTOCOL)}).strict(),
  skills: z.union([directory, z.array(directory).max(128)]).default([]),
  ui: z.object({panels: z.array(pluginPanelSchema).max(32)}).strict().default({panels: []}),
}).strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginPanel = z.infer<typeof pluginPanelSchema>;
export type PluginCapability = PluginManifest['capabilities'][string];

/** UI selection is explicit, but credentials and package execution identity remain host-owned. */
export const pluginUiReadSchema=z.object({
  requestId:z.uuid(),projectId:z.string().min(1).max(128),appId:id,panelId:id,
  packageHash:z.string().regex(/^[a-f0-9]{64}$/),capability:capabilityId,
  connectionScope:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  input:z.record(z.string(),z.unknown()),
}).strict();
export type PluginUiRead=z.infer<typeof pluginUiReadSchema>;
export const pluginPageContextSchema=pluginUiReadSchema.pick({projectId:true,appId:true,panelId:true,packageHash:true});
export type PluginPageContext=z.infer<typeof pluginPageContextSchema>;
