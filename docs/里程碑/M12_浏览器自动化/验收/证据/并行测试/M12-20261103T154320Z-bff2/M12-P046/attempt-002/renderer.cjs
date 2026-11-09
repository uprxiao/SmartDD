var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name3 in all)
    __defProp(target, name3, { get: all[name3], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/main/core/applications/application-skill-template.ts
var application_skill_template_exports = {};
__export(application_skill_template_exports, {
  applicationSkillDelivery: () => applicationSkillDelivery,
  applicationSkillParameters: () => applicationSkillParameters,
  applicationSkillProjectionName: () => applicationSkillProjectionName,
  renderApplicationSkill: () => renderApplicationSkill
});
module.exports = __toCommonJS(application_skill_template_exports);
var import_zod8 = require("zod");

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/applications.ts
var import_zod = require("zod");
var PACKAGE_OWNER_FILE = ".willyou-package-owner.json";
var APP_HASH_PATTERN = /^[a-f0-9]{64}$/;
var APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
var version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function isPackagePath(value) {
  if (!value || value !== value.normalize("NFC") || value.length > 1024 || /[\\:\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
var nativePart = (max) => import_zod.z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(max);
var path = import_zod.z.string().refine(isPackagePath, "\u5E94\u7528\u5305\u8DEF\u5F84\u65E0\u6548");
var hash = import_zod.z.string().regex(APP_HASH_PATTERN);
var operation = import_zod.z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
var api = import_zod.z.number().int().positive();
var applicationManifestSchema = import_zod.z.object({
  schema: import_zod.z.literal("smartdd-app-package-v1"),
  appId: nativePart(20),
  version: import_zod.z.string().regex(version),
  displayName: import_zod.z.string().trim().min(1).max(120),
  description: import_zod.z.string().max(4e3),
  hostApi: import_zod.z.object({ min: api, max: api }).strict(),
  dataApi: api,
  connectionContracts: import_zod.z.array(import_zod.z.object({
    providerId: import_zod.z.string().regex(APP_ID_PATTERN),
    configApiMajor: api,
    inputSchemaPath: path,
    authModes: import_zod.z.array(import_zod.z.string().min(1).max(80)).min(1),
    identityContractMajor: api
  }).strict()).min(1),
  runtime: import_zod.z.object({ id: import_zod.z.string().regex(APP_ID_PATTERN), hash, protocolMajor: api }).strict(),
  skills: import_zod.z.array(import_zod.z.object({ id: nativePart(16), path, entry: path, description: import_zod.z.string().max(2e3) }).strict()).min(1),
  tools: import_zod.z.array(import_zod.z.object({
    name: import_zod.z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9]\d*$/).max(128),
    contractMajor: api,
    inputSchemaPath: path,
    outputSchemaPath: path,
    permission: operation,
    annotations: import_zod.z.object({ readOnlyHint: import_zod.z.boolean(), destructiveHint: import_zod.z.boolean(), idempotentHint: import_zod.z.boolean(), openWorldHint: import_zod.z.boolean() }).strict()
  }).strict()).min(1),
  adapter: import_zod.z.object({ entry: path, format: import_zod.z.literal("cjs") }).strict(),
  migrations: import_zod.z.array(import_zod.z.object({ id: import_zod.z.string().regex(APP_ID_PATTERN), from: import_zod.z.number().int().nonnegative(), to: api, file: path, checksum: hash }).strict()),
  files: import_zod.z.array(import_zod.z.object({ path, sha256: hash, size: import_zod.z.number().int().nonnegative(), executable: import_zod.z.boolean() }).strict()).min(1).max(4096),
  permissions: import_zod.z.array(operation).min(1)
}).strict().superRefine((manifest, ctx) => {
  const issue = (message) => ctx.addIssue({ code: "custom", message });
  if (manifest.hostApi.min > manifest.hostApi.max) issue("\u5BBF\u4E3BAPI\u8303\u56F4\u65E0\u6548");
  const paths = /* @__PURE__ */ new Set(), folded = /* @__PURE__ */ new Set();
  for (const f of manifest.files) {
    if (["manifest.json", PACKAGE_OWNER_FILE].includes(f.path.split("/")[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase())) issue("\u5305\u8DEF\u5F84\u91CD\u590D\u3001\u5927\u5C0F\u5199\u51B2\u7A81\u6216\u4F7F\u7528\u4FDD\u7559\u540D\u79F0");
    paths.add(f.path);
    folded.add(f.path.toLowerCase());
  }
  const required = [manifest.adapter.entry, ...manifest.connectionContracts.map((c) => c.inputSchemaPath), ...manifest.tools.flatMap((t) => [t.inputSchemaPath, t.outputSchemaPath]), ...manifest.skills.map((s) => s.entry), ...manifest.migrations.map((m) => m.file)];
  if (required.some((p) => !paths.has(p))) issue("\u5305\u5165\u53E3\u6216\u5951\u7EA6\u672A\u5217\u5165\u5B8C\u6574\u6587\u4EF6\u6E05\u5355");
  for (const f of paths) for (const other of paths) if (other !== f && other.startsWith(f + "/")) issue("\u6587\u4EF6\u4E0E\u76EE\u5F55\u8DEF\u5F84\u51B2\u7A81");
  if (new Set(manifest.skills.map((s) => s.id)).size !== manifest.skills.length) issue("Skill\u6807\u8BC6\u91CD\u590D");
  if (manifest.skills.some((s) => !s.entry.startsWith(s.path + "/") || !s.entry.endsWith("/SKILL.md"))) issue("Skill\u5165\u53E3\u5FC5\u987B\u662F\u672CSkill\u76EE\u5F55\u5185\u7684SKILL.md");
  if (new Set(manifest.tools.map((t) => t.name)).size !== manifest.tools.length) issue("\u5DE5\u5177\u540D\u91CD\u590D");
  if (new Set(manifest.permissions).size !== manifest.permissions.length) issue("\u52A8\u4F5C\u6743\u9650\u91CD\u590D");
  const prefix = "smartdd_" + manifest.appId.replaceAll("-", "_") + "_";
  for (const t of manifest.tools) {
    if (!t.name.startsWith(prefix) || !t.name.endsWith("_v" + t.contractMajor)) issue("\u5DE5\u5177\u540D\u79F0\u4E0E\u5E94\u7528\u53CA\u4E3B\u5951\u7EA6\u4E0D\u4E00\u81F4");
    if (!manifest.permissions.includes(t.permission)) issue("\u5DE5\u5177\u6743\u9650\u672A\u5728\u5305\u58F0\u660E\u4E2D\u63D0\u4F9B");
    if (t.permission.endsWith(".send") && (t.annotations.readOnlyHint || t.annotations.idempotentHint)) issue("\u53D1\u9001\u5DE5\u5177\u4E0D\u5F97\u58F0\u660E\u4E3A\u53EA\u8BFB\u6216\u5E42\u7B49");
  }
  const migrations = /* @__PURE__ */ new Set();
  for (let i = 0; i < manifest.migrations.length; i++) {
    const m = manifest.migrations[i];
    if (migrations.has(m.id) || m.to !== m.from + 1 || i && m.from !== manifest.migrations[i - 1].to) issue("\u5E94\u7528\u8FC1\u79FB\u7F16\u53F7\u6216\u7248\u672C\u4E0D\u8FDE\u7EED");
    migrations.add(m.id);
    if (manifest.files.find((f) => f.path === m.file)?.sha256 !== m.checksum) issue("\u8FC1\u79FBchecksum\u4E0E\u6587\u4EF6\u6E05\u5355\u4E0D\u4E00\u81F4");
  }
});
var ApplicationError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ApplicationError";
  }
};

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/application-capabilities.ts
var import_zod2 = require("zod");
var api2 = import_zod2.z.number().int().positive();
var name = import_zod2.z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
var capabilityId = import_zod2.z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/).max(192);
var fields = applicationManifestSchema.shape;
var toolName = fields.tools.element.shape.name;
var capabilityProtectionSchema = import_zod2.z.object({
  kind: import_zod2.z.enum(["business-intent", "revision", "upstream-key", "operation-receipt"]),
  object: import_zod2.z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
  key: import_zod2.z.string().regex(/^[a-z][A-Za-z0-9_]{0,127}$/)
}).strict();
var mcp = import_zod2.z.object({ tool: toolName }).strict();
var cli = import_zod2.z.object({ command: import_zod2.z.array(name).min(2).max(8) }).strict();
var fallback = import_zod2.z.union([import_zod2.z.object({ mcp }).strict(), import_zod2.z.object({ cli }).strict()]);
var applicationCapabilitySchema = import_zod2.z.object({
  id: capabilityId,
  contractMajor: api2,
  title: import_zod2.z.string().trim().min(1).max(120),
  semantics: import_zod2.z.enum(["read", "write", "external-write"]),
  permission: fields.permissions.element,
  slots: import_zod2.z.object({ required: import_zod2.z.array(name).max(32), conditional: import_zod2.z.array(name).max(32) }).strict(),
  inputSchemaPath: fields.tools.element.shape.inputSchemaPath,
  outputSchemaPath: fields.tools.element.shape.outputSchemaPath,
  retry: import_zod2.z.enum(["safe-read", "never"]),
  protection: capabilityProtectionSchema.optional(),
  approval: import_zod2.z.literal("host-observed-user-authorization").optional(),
  legacyTool: import_zod2.z.object({ name: toolName, contractMajor: api2 }).strict().optional(),
  binding: import_zod2.z.object({ mcp: mcp.optional(), cli: cli.optional(), fallback: fallback.optional() }).strict()
}).strict();
var applicationManifestV2Schema = import_zod2.z.object({
  schema: import_zod2.z.literal("smartdd-app-package-v2"),
  appId: fields.appId,
  version: fields.version,
  displayName: fields.displayName,
  description: fields.description,
  hostApi: fields.hostApi,
  dataApi: fields.dataApi,
  runtime: fields.runtime,
  connectionContracts: import_zod2.z.array(fields.connectionContracts.element),
  module: import_zod2.z.object({ id: name, contractMajor: api2 }).strict(),
  entry: import_zod2.z.enum(["mcp", "cli"]),
  mixedEntries: import_zod2.z.literal(true).optional(),
  connectionSlots: import_zod2.z.array(import_zod2.z.object({ slot: name, required: import_zod2.z.boolean() }).strict()).max(32),
  capabilities: import_zod2.z.array(applicationCapabilitySchema).min(1).max(256),
  skills: import_zod2.z.array(fields.skills.element.extend({ template: import_zod2.z.boolean() })).min(1),
  permissions: fields.permissions,
  migrations: fields.migrations,
  files: fields.files
}).strict().superRefine((manifest, ctx) => {
  const issue = (message) => ctx.addIssue({ code: "custom", message });
  if (manifest.hostApi.min > manifest.hostApi.max) issue("\u5BBF\u4E3BAPI\u8303\u56F4\u65E0\u6548");
  const paths = /* @__PURE__ */ new Set(), folded = /* @__PURE__ */ new Set();
  for (const f of manifest.files) {
    if (["manifest.json", PACKAGE_OWNER_FILE].includes(f.path.split("/")[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase())) issue("\u5305\u8DEF\u5F84\u91CD\u590D\u3001\u5927\u5C0F\u5199\u51B2\u7A81\u6216\u4F7F\u7528\u4FDD\u7559\u540D\u79F0");
    paths.add(f.path);
    folded.add(f.path.toLowerCase());
  }
  const required = [
    ...manifest.connectionContracts.map((c) => c.inputSchemaPath),
    ...manifest.capabilities.flatMap((c) => [c.inputSchemaPath, c.outputSchemaPath]),
    ...manifest.skills.map((s) => s.entry),
    ...manifest.migrations.map((m) => m.file)
  ];
  if (required.some((p) => !paths.has(p))) issue("\u5305\u5165\u53E3\u6216\u5951\u7EA6\u672A\u5217\u5165\u5B8C\u6574\u6587\u4EF6\u6E05\u5355");
  for (const f of paths) for (const other of paths) if (other !== f && other.startsWith(f + "/")) issue("\u6587\u4EF6\u4E0E\u76EE\u5F55\u8DEF\u5F84\u51B2\u7A81");
  if (new Set(manifest.skills.map((s) => s.id)).size !== manifest.skills.length) issue("Skill\u6807\u8BC6\u91CD\u590D");
  if (manifest.skills.some((s) => !s.entry.startsWith(s.path + "/") || !s.entry.endsWith("/SKILL.md"))) issue("Skill\u5165\u53E3\u5FC5\u987B\u662F\u672CSkill\u76EE\u5F55\u5185\u7684SKILL.md");
  if (new Set(manifest.permissions).size !== manifest.permissions.length) issue("\u52A8\u4F5C\u6743\u9650\u91CD\u590D");
  if (manifest.permissions.some((p) => !p.startsWith(manifest.appId + "."))) issue("\u52A8\u4F5C\u6743\u9650\u5FC5\u987B\u5C5E\u4E8E\u672C\u5E94\u7528");
  if (new Set(manifest.connectionContracts.map((c) => c.providerId)).size !== manifest.connectionContracts.length) issue("\u8FDE\u63A5\u914D\u7F6E\u5951\u7EA6\u91CD\u590D");
  const migrations = /* @__PURE__ */ new Set();
  for (let i = 0; i < manifest.migrations.length; i++) {
    const m = manifest.migrations[i];
    if (migrations.has(m.id) || m.to !== m.from + 1 || i && m.from !== manifest.migrations[i - 1].to) issue("\u5E94\u7528\u8FC1\u79FB\u7F16\u53F7\u6216\u7248\u672C\u4E0D\u8FDE\u7EED");
    migrations.add(m.id);
    if (manifest.files.find((f) => f.path === m.file)?.sha256 !== m.checksum) issue("\u8FC1\u79FBchecksum\u4E0E\u6587\u4EF6\u6E05\u5355\u4E0D\u4E00\u81F4");
  }
  const slots = new Set(manifest.connectionSlots.map((s) => s.slot));
  if (slots.size !== manifest.connectionSlots.length) issue("\u8FDE\u63A5\u69FD\u91CD\u590D");
  if (manifest.connectionSlots.some((s) => !manifest.connectionContracts.some((c) => c.providerId === s.slot))) issue("\u8FDE\u63A5\u69FD\u6CA1\u6709\u914D\u7F6E\u5951\u7EA6");
  if (new Set(manifest.capabilities.map((c) => c.id)).size !== manifest.capabilities.length) issue("\u80FD\u529B\u6807\u8BC6\u91CD\u590D");
  const names = /* @__PURE__ */ new Set(), commands = /* @__PURE__ */ new Set(), legacy = /* @__PURE__ */ new Set();
  for (const c of manifest.capabilities) {
    if (!c.id.startsWith(manifest.appId + ".")) issue("\u80FD\u529B\u6807\u8BC6\u524D\u7F00\u4E0E\u5E94\u7528\u4E0D\u7B26");
    if (!manifest.permissions.includes(c.permission)) issue("\u80FD\u529B\u6743\u9650\u672A\u5728\u5305\u58F0\u660E\u4E2D\u63D0\u4F9B");
    const primary = c.binding.mcp ? "mcp" : c.binding.cli ? "cli" : null;
    if (!primary || !!c.binding.mcp === !!c.binding.cli) issue("\u80FD\u529B\u5FC5\u987B\u6070\u597D\u58F0\u660E\u4E00\u4E2A\u4E3B\u5165\u53E3");
    if (primary && primary !== manifest.entry && !manifest.mixedEntries) issue("\u80FD\u529B\u4E3B\u5165\u53E3\u4E0E\u5E94\u7528\u5165\u53E3\u4E0D\u540C");
    if (c.semantics !== "read" && (!c.protection || c.retry !== "never")) issue("\u5199\u80FD\u529B\u5FC5\u987B\u58F0\u660E\u4E1A\u52A1\u7EA7\u4FDD\u62A4\u4E14\u4E0D\u5F97\u81EA\u52A8\u91CD\u8BD5");
    if (c.semantics === "external-write" && !c.approval) issue("\u5916\u90E8\u5199\u80FD\u529B\u5FC5\u987B\u58F0\u660E\u5BBF\u4E3B\u89C2\u5BDF\u6388\u6743");
    if (c.binding.fallback && (c.semantics !== "read" || primary && Object.hasOwn(c.binding.fallback, primary))) issue("\u964D\u7EA7\u5165\u53E3\u4EC5\u7528\u4E8E\u53EA\u8BFB\u4E14\u5FC5\u987B\u4E0D\u540C\u4E8E\u4E3B\u5165\u53E3");
    const required2 = new Set(c.slots.required), conditional = new Set(c.slots.conditional);
    if (required2.size !== c.slots.required.length || conditional.size !== c.slots.conditional.length || [...required2].some((s) => conditional.has(s))) issue("\u80FD\u529B\u69FD\u4F9D\u8D56\u91CD\u590D");
    if ([...required2, ...conditional].some((s) => !slots.has(s))) issue("\u80FD\u529B\u5F15\u7528\u4E86\u672A\u58F0\u660E\u7684\u8FDE\u63A5\u69FD");
    for (const binding of [c.binding, c.binding.fallback]) {
      if (!binding) continue;
      if ("mcp" in binding && binding.mcp) {
        const tool2 = binding.mcp.tool;
        if (!tool2.startsWith("smartdd_" + manifest.appId.replaceAll("-", "_") + "_") || !tool2.endsWith("_v" + c.contractMajor)) issue("MCP\u5DE5\u5177\u540D\u79F0\u4E0E\u5E94\u7528\u6216\u80FD\u529B\u5951\u7EA6\u4E0D\u7B26");
        if (names.has(tool2)) issue("MCP\u5DE5\u5177\u540D\u91CD\u590D");
        names.add(tool2);
      }
      if ("cli" in binding && binding.cli) {
        if (binding.cli.command[0] !== manifest.appId) issue("CLI\u547D\u4EE4\u5FC5\u987B\u4EE5\u5E94\u7528\u6807\u8BC6\u5F00\u5934");
        const key = binding.cli.command.join(" ");
        if (commands.has(key)) issue("CLI\u547D\u4EE4\u91CD\u590D");
        commands.add(key);
      }
    }
    if (c.legacyTool) {
      const t = c.legacyTool;
      if (!t.name.startsWith("smartdd_" + manifest.appId.replaceAll("-", "_") + "_") || !t.name.endsWith("_v" + t.contractMajor) || legacy.has(t.name)) issue("\u65E7\u5DE5\u5177\u6620\u5C04\u91CD\u590D\u6216\u5951\u7EA6\u4E0D\u7B26");
      legacy.add(t.name);
    }
  }
  if (manifest.files.some((f) => f.executable || /\.(?:[cm]?js|node|wasm|py|sh|exe|dll|dylib)$/i.test(f.path))) issue("v2\u5E94\u7528\u5305\u4E0D\u5F97\u643A\u5E26\u6267\u884C\u4EE3\u7801");
});
var applicationPackageManifestSchema = import_zod2.z.discriminatedUnion("schema", [applicationManifestSchema, applicationManifestV2Schema]);
function applicationCapabilityViews(manifest, legacyPolicy) {
  if (manifest.schema === "smartdd-app-package-v2") return structuredClone(manifest.capabilities);
  if (!legacyPolicy) throw new ApplicationError("HOST_INCOMPATIBLE", "\u65E7\u5305\u80FD\u529B\u89C6\u56FE\u9700\u8981\u53D7\u4FE1\u6A21\u5757\u7684\u4E1A\u52A1\u7B56\u7565");
  return manifest.tools.map((tool2) => {
    const policy = legacyPolicy(tool2);
    if (!policy.id.startsWith(manifest.appId + ".") || policy.semantics === "read" !== tool2.annotations.readOnlyHint || policy.semantics !== "read" && (!policy.protection || policy.retry !== "never") || policy.semantics === "external-write" && !policy.approval) throw new ApplicationError("HOST_INCOMPATIBLE", "\u65E7\u5305\u4E1A\u52A1\u7B56\u7565\u4E0E\u56FA\u5B9A\u5951\u7EA6\u4E0D\u7B26");
    return applicationCapabilitySchema.parse({
      ...policy,
      title: tool2.name,
      contractMajor: tool2.contractMajor,
      permission: tool2.permission,
      inputSchemaPath: tool2.inputSchemaPath,
      outputSchemaPath: tool2.outputSchemaPath,
      legacyTool: { name: tool2.name, contractMajor: tool2.contractMajor },
      binding: { mcp: { tool: tool2.name } }
    });
  });
}

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/application-run-plan.ts
var import_zod3 = require("zod");
var hash2 = import_zod3.z.string().regex(/^[a-f0-9]{64}$/);
var id = import_zod3.z.string().min(1).max(128);
var adapter = import_zod3.z.object({ id, version: import_zod3.z.string().min(1).max(128), hash: hash2 }).strict();
var allowed = import_zod3.z.object({ capabilityId: import_zod3.z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/), contractMajor: import_zod3.z.number().int().positive(), appId: id, packageHash: hash2, entry: import_zod3.z.enum(["mcp", "cli"]), mcpTool: import_zod3.z.string().max(256).optional(), cliCommand: import_zod3.z.array(import_zod3.z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(2).max(8).optional() }).strict();
var applicationRunPlanSchema = import_zod3.z.object({
  schema: import_zod3.z.literal("willyou-application-run-plan-v1"),
  runId: import_zod3.z.uuid(),
  taskId: id,
  projectId: id,
  snapshotHash: hash2,
  runner: adapter,
  capabilityAdapter: adapter,
  cliVersion: import_zod3.z.string().min(1).max(128),
  grades: import_zod3.z.object({ skill: import_zod3.z.boolean(), mcp: import_zod3.z.boolean(), cli: import_zod3.z.boolean(), configuration: import_zod3.z.boolean(), discoveryObserved: import_zod3.z.boolean(), userMessageObserved: import_zod3.z.boolean(), evidence: import_zod3.z.array(import_zod3.z.string().min(1).max(512)).max(32) }).strict(),
  applications: import_zod3.z.array(import_zod3.z.object({ appId: id, packageHash: hash2, primaryEntry: import_zod3.z.enum(["mcp", "cli"]), effectiveEntry: import_zod3.z.enum(["mcp", "cli", "mixed", "unavailable"]), fallback: import_zod3.z.boolean(), reason: import_zod3.z.string().max(512).nullable() }).strict()).max(32),
  allowed: import_zod3.z.array(allowed).max(8192),
  skills: import_zod3.z.array(import_zod3.z.object({ appId: id, skillId: id, nativeName: import_zod3.z.string().max(64), templateHash: hash2, parametersHash: hash2, renderedHash: hash2 }).strict()).max(2048),
  sandbox: import_zod3.z.object({ source: import_zod3.z.string().min(1).max(128), digest: hash2.nullable() }).strict(),
  createdAt: import_zod3.z.iso.datetime(),
  planHash: hash2
}).strict().superRefine((plan, ctx) => {
  const fail = (message) => ctx.addIssue({ code: "custom", message });
  if (new Set(plan.applications.map((a) => a.appId)).size !== plan.applications.length || new Set(plan.allowed.map((c) => c.capabilityId)).size !== plan.allowed.length || new Set(plan.skills.map((s) => s.nativeName)).size !== plan.skills.length) fail("\u8FD0\u884C\u8BA1\u5212\u7684\u5E94\u7528\u3001\u80FD\u529B\u6216Skill\u91CD\u590D");
  for (const c of plan.allowed) {
    if (!plan.applications.some((a) => a.appId === c.appId && a.packageHash === c.packageHash) || !c.capabilityId.startsWith(c.appId + ".") || c.entry === "mcp" && !c.mcpTool || c.entry === "cli" && !c.cliCommand) fail("\u8FD0\u884C\u5141\u8BB8\u8868\u4E0E\u5E94\u7528\u6216\u5165\u53E3\u4E0D\u4E00\u81F4");
  }
  if (plan.skills.some((s) => !plan.applications.some((a) => a.appId === s.appId))) fail("\u8FD0\u884CSkill\u4E0D\u5C5E\u4E8E\u9009\u7528\u5E94\u7528");
});

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/application-session-v3.ts
var import_zod6 = require("zod");

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/agent-id.ts
var import_zod4 = require("zod");
var agentIdSchema = import_zod4.z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/application-session.ts
var import_zod5 = require("zod");
var hash3 = import_zod5.z.string().regex(/^[a-f0-9]{64}$/);
var id2 = import_zod5.z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
var absolute = import_zod5.z.string().min(1).max(4096).refine((s) => (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\")) && !/[\x00\r\n]/.test(s));
var name2 = import_zod5.z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
var tool = import_zod5.z.string().min(1).max(256).regex(/^[A-Za-z_][A-Za-z0-9_.:-]*$/).refine((s) => !["__proto__", "constructor", "prototype"].includes(s));
var version2 = import_zod5.z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
var capabilitySessionSnapshotSchema = import_zod5.z.object({
  schema: import_zod5.z.literal(2),
  taskId: id2,
  projectId: id2,
  createdAt: import_zod5.z.iso.datetime(),
  runner: agentIdSchema,
  adapterBinding: import_zod5.z.object({ id: id2, version: version2, hash: hash3, projectionFormatVersion: import_zod5.z.number().int().positive(), nativeToolNames: import_zod5.z.record(tool, tool) }).strict(),
  native: import_zod5.z.object({ sessionId: import_zod5.z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).nullable(), stateRoot: absolute, cwd: absolute }).strict(),
  agentAtCreation: import_zod5.z.object({ version: import_zod5.z.string().min(1).max(128), adapterRevision: import_zod5.z.number().int().positive() }).strict(),
  catalogGeneration: import_zod5.z.string().min(1).max(256),
  packages: import_zod5.z.array(import_zod5.z.object({
    appId: name2.max(20),
    version: version2,
    packageHash: hash3,
    hashAlgorithm: import_zod5.z.literal("app-manifest-v1"),
    hostApi: import_zod5.z.object({ min: import_zod5.z.number().int().positive(), max: import_zod5.z.number().int().positive() }).strict(),
    dataApi: import_zod5.z.number().int().positive(),
    runtimeHash: hash3,
    toolContractMajors: import_zod5.z.record(tool, import_zod5.z.number().int().positive()),
    skills: import_zod5.z.array(import_zod5.z.object({ skillId: name2.max(16), nativeName: name2, contentHash: hash3, sourceRelativePath: import_zod5.z.string().refine(isPackagePath), projectionPath: absolute.refine((p) => p.endsWith("/SKILL.md")) }).strict()).min(1).max(64),
    bindings: import_zod5.z.array(import_zod5.z.object({ bindingId: import_zod5.z.string().min(1).max(512), connectionId: import_zod5.z.uuid(), identityRevision: import_zod5.z.number().int().positive() }).strict()).max(16),
    allowedOperations: import_zod5.z.array(import_zod5.z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.-]*$/)).max(256)
  }).strict()).max(32),
  standardSkills: import_zod5.z.array(import_zod5.z.object({ skillId: name2, versionId: import_zod5.z.string().min(1).max(512), hash: hash3, hashAlgorithm: import_zod5.z.literal("legacy-tree-v1"), projectionPath: absolute.refine((p) => p.endsWith("/SKILL.md")) }).strict()).max(64),
  mcp: import_zod5.z.array(import_zod5.z.object({ kind: import_zod5.z.enum(["applications", "legacy-project-context"]), serverName: import_zod5.z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), protocolMajor: import_zod5.z.number().int().positive(), runtimeHash: hash3 }).strict()).max(2),
  legacyBinding: import_zod5.z.object({ sourceSnapshotHash: hash3, sourceRecordHash: hash3, identityHash: hash3, manifestHash: hash3, logicalEvidenceHash: hash3, pluginSourceHash: hash3.optional() }).strict().optional(),
  provenance: import_zod5.z.enum(["created", "migrated-known-legacy"])
}).strict().superRefine((snapshot, ctx) => {
  const fail = (message) => ctx.addIssue({ code: "custom", message });
  if (Object.keys(snapshot.adapterBinding.nativeToolNames).length > 512 || new Set(Object.values(snapshot.adapterBinding.nativeToolNames)).size !== Object.keys(snapshot.adapterBinding.nativeToolNames).length) fail("\u539F\u751F\u5DE5\u5177\u540D\u79F0\u6620\u5C04\u91CD\u590D\u6216\u8D85\u8FC7\u9884\u7B97");
  if (snapshot.provenance === "migrated-known-legacy" && snapshot.packages.length) fail("\u65E2\u6709M4\u5386\u53F2\u4E0D\u80FD\u81EA\u52A8\u589E\u52A0M10\u5E94\u7528");
  if (snapshot.legacyBinding && (snapshot.provenance !== "migrated-known-legacy" || snapshot.adapterBinding.projectionFormatVersion !== 2)) fail("\u539FM4\u6765\u6E90\u7ED1\u5B9A\u4EC5\u5C5E\u4E8E\u65E7\u683C\u5F0F\u8FC1\u79FB");
  if (snapshot.adapterBinding.projectionFormatVersion === 2 && !snapshot.legacyBinding) fail("\u65E7\u683C\u5F0F\u8FC1\u79FB\u987B\u56FA\u5B9A\u539FM4\u6765\u6E90\u4F9D\u636E");
  if (snapshot.adapterBinding.id !== snapshot.runner) fail("Agent\u9002\u914D\u5668\u4E0E\u539F\u751F\u8FD0\u884C\u5668\u4E0D\u540C");
  if (new Set(snapshot.packages.map((p) => p.appId)).size !== snapshot.packages.length) fail("\u540C\u4E00\u5E94\u7528\u4E0D\u80FD\u5728\u4F1A\u8BDD\u4E2D\u9009\u62E9\u4E24\u4E2A\u7248\u672C");
  if (new Set(snapshot.standardSkills.map((s) => s.skillId)).size !== snapshot.standardSkills.length) fail("\u540C\u4E00\u6807\u51C6Skill\u4E0D\u80FD\u9009\u62E9\u4E24\u4E2A\u7248\u672C");
  const skills = snapshot.packages.flatMap((p) => p.skills);
  const paths = [...skills.map((s) => s.projectionPath), ...snapshot.standardSkills.map((s) => s.projectionPath)];
  if (new Set(paths).size !== paths.length || new Set(skills.map((s) => s.nativeName)).size !== skills.length) fail("\u539F\u751FSkill\u540D\u79F0\u6216\u8DEF\u5F84\u91CD\u590D");
  if (new Set(snapshot.mcp.map((m) => m.serverName)).size !== snapshot.mcp.length || new Set(snapshot.mcp.map((m) => m.kind)).size !== snapshot.mcp.length) fail("MCP\u540D\u79F0\u6216\u6865\u7C7B\u522B\u91CD\u590D");
  const bridge = snapshot.mcp.find((m) => m.kind === "applications");
  if (snapshot.packages.length && (!bridge || snapshot.packages.some((p) => p.runtimeHash !== bridge.runtimeHash))) fail("\u672C\u4F1A\u8BDD\u5E94\u7528\u5FC5\u987B\u4F7F\u7528\u540C\u4E00\u56FA\u5B9A\u4E1A\u52A1\u6865");
  if (!snapshot.packages.length && bridge) fail("\u672A\u9009\u5E94\u7528\u7684\u5386\u53F2\u4E0D\u80FD\u81EA\u52A8\u589E\u52A0\u4E1A\u52A1\u6865");
  for (const p of snapshot.packages) {
    if (new Set(p.skills.map((s) => s.skillId)).size !== p.skills.length || new Set(p.allowedOperations).size !== p.allowedOperations.length) fail("\u5E94\u7528Skill\u6216\u52A8\u4F5C\u91CD\u590D");
    if (p.hostApi.min > p.hostApi.max) fail("\u5E94\u7528\u5BBF\u4E3B\u5951\u7EA6\u8303\u56F4\u65E0\u6548");
    for (const s of p.skills) if (s.nativeName !== applicationNativeSkillName(p.appId, s.skillId, p.packageHash)) fail("\u5E94\u7528\u539F\u751FSkill\u540D\u79F0\u672A\u56FA\u5B9A\u5230\u5305\u7248\u672C");
  }
});
var applicationNativeSkillName = (appId, skillId, packageHash) => `smartdd-a-${appId}-${skillId}-${packageHash.slice(0, 12)}`;

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/application-session-v3.ts
var fields2 = capabilitySessionSnapshotSchema.shape;
var capabilitySessionSnapshotV3Schema = import_zod6.z.object({
  ...fields2,
  schema: import_zod6.z.literal(3),
  packages: import_zod6.z.array(fields2.packages.element.extend({
    entry: import_zod6.z.enum(["mcp", "cli"]),
    capabilityContractMajors: import_zod6.z.record(import_zod6.z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/), import_zod6.z.number().int().positive())
  }).strict()).max(32)
}).strict().superRefine((snapshot, ctx) => {
  const fail = (message) => ctx.addIssue({ code: "custom", message });
  if (Object.keys(snapshot.adapterBinding.nativeToolNames).length > 512 || new Set(Object.values(snapshot.adapterBinding.nativeToolNames)).size !== Object.keys(snapshot.adapterBinding.nativeToolNames).length) fail("\u539F\u751F\u5DE5\u5177\u6620\u5C04\u91CD\u590D\u6216\u8D85\u8FC7\u9884\u7B97");
  if (snapshot.adapterBinding.id !== snapshot.runner || snapshot.legacyBinding || snapshot.provenance !== "created" || snapshot.adapterBinding.projectionFormatVersion !== 1) fail("\u65B0\u5FEB\u7167\u4E0D\u80FD\u5192\u5145\u65E7\u683C\u5F0F\u8FC1\u79FB");
  if (new Set(snapshot.packages.map((p) => p.appId)).size !== snapshot.packages.length || new Set(snapshot.standardSkills.map((s) => s.skillId)).size !== snapshot.standardSkills.length) fail("\u5FEB\u7167\u5E94\u7528\u6216\u6807\u51C6Skill\u91CD\u590D");
  const skills = snapshot.packages.flatMap((p) => p.skills), paths = [...skills.map((s) => s.projectionPath), ...snapshot.standardSkills.map((s) => s.projectionPath)];
  if (new Set(paths).size !== paths.length || new Set(skills.map((s) => s.nativeName)).size !== skills.length) fail("Skill\u540D\u79F0\u6216\u6295\u5F71\u8DEF\u5F84\u91CD\u590D");
  if (new Set(snapshot.mcp.map((m) => m.serverName)).size !== snapshot.mcp.length || new Set(snapshot.mcp.map((m) => m.kind)).size !== snapshot.mcp.length) fail("MCP\u540D\u79F0\u6216\u6865\u7C7B\u522B\u91CD\u590D");
  const requiringMcp = snapshot.packages.filter((p) => Object.keys(p.toolContractMajors).length > 0), bridge = snapshot.mcp.find((m) => m.kind === "applications");
  if (requiringMcp.length && (!bridge || requiringMcp.some((p) => p.runtimeHash !== bridge.runtimeHash))) fail("MCP\u80FD\u529B\u987B\u6709\u5BF9\u5E94\u7684\u56FA\u5B9A\u4E1A\u52A1\u6865");
  if (!requiringMcp.length && bridge) fail("\u7EAFCLI\u5E94\u7528\u4E0D\u80FD\u81EA\u52A8\u589E\u52A0MCP\u6865");
  for (const p of snapshot.packages) {
    if (new Set(p.skills.map((s) => s.skillId)).size !== p.skills.length || new Set(p.allowedOperations).size !== p.allowedOperations.length || p.hostApi.min > p.hostApi.max) fail("\u5E94\u7528Skill\u3001\u52A8\u4F5C\u6216\u5BBF\u4E3B\u8303\u56F4\u65E0\u6548");
    if (Object.keys(p.capabilityContractMajors).length > 256 || Object.keys(p.capabilityContractMajors).some((id4) => !id4.startsWith(p.appId + "."))) fail("\u80FD\u529B\u6807\u8BC6\u4E0D\u5C5E\u4E8E\u672C\u5E94\u7528");
    for (const s of p.skills) if (s.nativeName !== applicationNativeSkillName(p.appId, s.skillId, p.packageHash)) fail("Skill\u540D\u79F0\u672A\u56FA\u5B9A\u5230\u539F\u5305");
  }
});
var storedCapabilitySessionSnapshotSchema = import_zod6.z.discriminatedUnion("schema", [capabilitySessionSnapshotSchema, capabilitySessionSnapshotV3Schema]);

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/main/core/applications/manifest.ts
var import_node_crypto = require("node:crypto");

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/shared/application-bridge.ts
var import_zod7 = require("zod");
var BRIDGE_LIMITS = { requestBytes: 256 * 1024, responseBytes: 1024 * 1024, resourceChunkBytes: 256 * 1024, maxDepth: 32, maxNodes: 2e4 };
var id3 = import_zod7.z.uuid();
var secret = import_zod7.z.string().regex(/^[a-f0-9]{64}$/);
var bridgeCallSchema = import_zod7.z.object({ operation: import_zod7.z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9][0-9]*$/).max(128), contractMajor: import_zod7.z.number().int().positive(), connectionId: import_zod7.z.uuid().nullable(), arguments: import_zod7.z.record(import_zod7.z.string(), import_zod7.z.unknown()) }).strict();
var bridgeRequestSchema = import_zod7.z.discriminatedUnion("method", [
  import_zod7.z.object({ schema: import_zod7.z.literal(1), id: id3, method: import_zod7.z.literal("exchange"), runId: id3, bridgeId: id3, secret }).strict(),
  import_zod7.z.object({ schema: import_zod7.z.literal(1), id: id3, method: import_zod7.z.literal("renew"), token: secret }).strict(),
  import_zod7.z.object({ schema: import_zod7.z.literal(1), id: id3, method: import_zod7.z.literal("tools/list"), token: secret }).strict(),
  import_zod7.z.object({ schema: import_zod7.z.literal(1), id: id3, method: import_zod7.z.literal("tools/call"), token: secret, call: bridgeCallSchema }).strict(),
  import_zod7.z.object({ schema: import_zod7.z.literal(1), id: id3, method: import_zod7.z.literal("cancel"), token: secret, targetId: id3 }).strict()
]);
var bridgeBootstrapSchema = import_zod7.z.object({ schema: import_zod7.z.literal(1), endpoint: import_zod7.z.string().min(1).max(100), runId: id3, bridgeId: id3, secret, hostGeneration: id3, expiresAt: import_zod7.z.number().int().positive() }).strict();

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/main/core/applications/manifest.ts
var digest = (value) => (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
function compareCodePoints(a, b) {
  const aa = Array.from(a, (c) => c.codePointAt(0)), bb = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Array.from(value).some((v) => v === void 0)) throw new ApplicationError("INVALID_PACKAGE", "\u6570\u7EC4\u542B\u6709\u975EJSON\u503C");
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return "{" + Object.keys(value).sort(compareCodePoints).map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  throw new ApplicationError("INVALID_PACKAGE", "\u89C4\u8303\u5316\u6458\u8981\u53EA\u63A5\u53D7JSON\u503C");
}

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/main/core/applications/run-plan.ts
function selectCapabilityEntry(capability, available) {
  const primary = capability.binding.cli ? "cli" : "mcp";
  if (available[primary]) return { entry: primary, fallback: false, reason: null };
  const fallback2 = capability.binding.fallback, entry = fallback2 && ("mcp" in fallback2 ? "mcp" : "cli");
  if (capability.semantics === "read" && entry && available[entry]) return { entry, fallback: true, reason: available.reason ?? `${primary} unavailable` };
  return { entry: null, fallback: false, reason: available.reason ?? `${primary} unavailable; no permitted fallback` };
}
function renderSkillTemplate(template, parameters) {
  const text = template.toString("utf8");
  if (!Buffer.from(text).equals(template)) throw new ApplicationError("INVALID_PACKAGE", "Skill\u6A21\u677F\u5FC5\u987B\u4E3A\u5B8C\u6574UTF-8");
  const values = { WILLYOU_APPLICATION: parameters.appId, WILLYOU_ENTRYPOINTS: parameters.entrypoints.map((c) => `- ${c.capabilityId}: ${c.invocation}`).join("\n") || "\u672C\u6B21\u8FD0\u884C\u6CA1\u6709\u53EF\u8C03\u7528\u7684\u5E94\u7528\u80FD\u529B\u3002" };
  const rendered = text.replace(/\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g, (_match, key) => {
    if (!Object.hasOwn(values, key)) throw new ApplicationError("INVALID_PACKAGE", "Skill\u6A21\u677F\u5305\u542B\u672A\u652F\u6301\u7684\u5360\u4F4D\u7B26");
    return values[key];
  });
  const bytes = Buffer.from(rendered);
  return { bytes, templateHash: digest(template), parametersHash: digest(canonicalJson(parameters)), renderedHash: digest(bytes) };
}

// ../../../../../private/tmp/willyou-m12-p046-skill-software-001/work/src/main/core/applications/application-skill-template.ts
var deliverySchema = import_zod8.z.object({ schema: import_zod8.z.literal(1), allowedOperations: import_zod8.z.array(import_zod8.z.string()).max(256), available: import_zod8.z.object({ mcp: import_zod8.z.boolean(), cli: import_zod8.z.boolean() }).strict() }).strict();
function applicationSkillDelivery(manifest, allowedOperations, available) {
  if (manifest.schema !== "smartdd-app-package-v2") return void 0;
  const capabilities = manifest.capabilities.filter((c) => allowedOperations.includes(c.permission));
  const selected = capabilities.map((c) => selectCapabilityEntry(c, available).entry);
  return { schema: 1, allowedOperations: [...allowedOperations], available: { mcp: selected.includes("mcp"), cli: selected.includes("cli") } };
}
function applicationSkillProjectionName(manifest, skillId, packageHash, delivery) {
  const variant = manifest.schema === "smartdd-app-package-v2" && manifest.skills.some((s) => s.id === skillId && s.template) && manifest.capabilities.some((c) => !!c.binding.cli || !!c.binding.fallback && "cli" in c.binding.fallback);
  if (!variant) return applicationNativeSkillName(manifest.appId, skillId, packageHash);
  if (!delivery) throw new ApplicationError("INVALID_PACKAGE", "\u52A8\u6001Skill\u7F3A\u5C11\u672C\u6B21\u5165\u53E3\u53C2\u6570");
  return applicationNativeSkillName(manifest.appId, skillId, digest(canonicalJson({ packageHash, skillId, parameters: applicationSkillParameters(manifest, delivery) })));
}
function applicationSkillParameters(manifest, raw) {
  const parsed = deliverySchema.safeParse(raw);
  if (!parsed.success || manifest.schema !== "smartdd-app-package-v2") throw new ApplicationError("INVALID_PACKAGE", "\u5E94\u7528\u6A21\u677F\u7684\u4EA4\u4ED8\u53C2\u6570\u65E0\u6548");
  const delivery = parsed.data;
  if (new Set(delivery.allowedOperations).size !== delivery.allowedOperations.length || delivery.allowedOperations.some((p) => !manifest.permissions.includes(p))) throw new ApplicationError("SCOPE_DENIED", "\u6A21\u677F\u80FD\u529B\u8D85\u8FC7\u539F\u5305\u6743\u9650");
  return { appId: manifest.appId, entrypoints: applicationCapabilityViews(manifest).filter((c) => delivery.allowedOperations.includes(c.permission)).flatMap((capability) => {
    const choice = selectCapabilityEntry(capability, delivery.available);
    if (!choice.entry) return [];
    const binding = choice.fallback ? capability.binding.fallback : capability.binding;
    const invocation = "mcp" in binding && binding.mcp ? `MCP \u5DE5\u5177 ${binding.mcp.tool}` : "cli" in binding && binding.cli ? `willyou-app ${binding.cli.command.join(" ")}` : "";
    return [{ capabilityId: capability.id, entry: choice.entry, invocation }];
  }) };
}
function renderApplicationSkill(bytes, manifest, skillId, delivery) {
  const template = manifest.schema === "smartdd-app-package-v2" && manifest.skills.find((s) => s.id === skillId)?.template;
  if (!template) {
    if (delivery) throw new ApplicationError("INVALID_PACKAGE", "\u975E\u6A21\u677FSkill\u4E0D\u80FD\u643A\u5E26\u6E32\u67D3\u53C2\u6570");
    return bytes;
  }
  if (!delivery) throw new ApplicationError("INVALID_PACKAGE", "\u6A21\u677FSkill\u7F3A\u5C11\u53D7\u4FE1\u4EA4\u4ED8\u53C2\u6570");
  return renderSkillTemplate(bytes, applicationSkillParameters(manifest, delivery)).bytes;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  applicationSkillDelivery,
  applicationSkillParameters,
  applicationSkillProjectionName,
  renderApplicationSkill
});
