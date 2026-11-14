import { createHash, randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { providerEndpointsSchema, type ProviderModel } from '@shared/ai-agents';
import type { AppDb } from '../../db/client';
import { aiProfiles, aiProviders, aiRunConfigs, aiTools, appSecrets } from '../../db/schema';

const storedEnvSchema = z.array(z.object({ name: z.string(), secret: z.boolean(), value: z.string().nullable() }).strict());
const storedArgsSchema = z.array(z.string());
const modelNames = new Set(['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']);
const advancedNames = new Set(['MAX_THINKING_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'API_TIMEOUT_MS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_DISABLE_1M_CONTEXT']);
type OldProfile = typeof aiProfiles.$inferSelect;
type Classification = { source: 'login' } | { source: 'legacy'; reason: string } |
  { source: 'provider'; endpoint: string; secretRef: string; authType: 'bearer' | 'api-key'; models: string[]; defaultModel: string };

function nativeCodexArgs(args: string[]): boolean {
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (['--no-alt-screen', '--no-daemon', '--search'].includes(flag)) continue;
    if (['-m', '--model', '-a', '--ask-for-approval', '-s', '--sandbox', '-c', '--config'].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith('-')) return false;
      if (['-c', '--config'].includes(flag) && !/^model_reasoning_effort\s*=\s*"?(?:minimal|low|medium|high|xhigh)"?$/.test(value)) return false;
      if (['-a', '--ask-for-approval'].includes(flag) && !['untrusted', 'on-failure', 'on-request', 'never'].includes(value)) return false;
      if (['-s', '--sandbox'].includes(flag) && !['read-only', 'workspace-write', 'danger-full-access'].includes(value)) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** Classification never decrypts credentials or edits the old profile. */
function classify(row: OldProfile, secretKeys: Set<string>): Classification {
  let env: z.infer<typeof storedEnvSchema>, args: string[];
  try { env = storedEnvSchema.parse(JSON.parse(row.env)); args = storedArgsSchema.parse(JSON.parse(row.args)); }
  catch { return { source: 'legacy', reason: '旧配置数据格式无法可靠识别' }; }
  if (new Set(env.map((entry) => entry.name)).size !== env.length) return { source: 'legacy', reason: '旧配置有重复环境变量' };
  if (row.runner === 'codex') return env.length === 0 && nativeCodexArgs(args) ? { source: 'login' } : { source: 'legacy', reason: '包含未识别的 Codex 环境变量或启动参数' };
  if (row.runner !== 'claude') return { source: 'legacy', reason: '尚未适配的 Code Agent' };
  if (!env.length && !args.length) return { source: 'login' };
  if (args.length) return { source: 'legacy', reason: '包含未识别的 Claude Code 启动参数' };
  const allowed = new Set(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', ...modelNames, ...advancedNames]);
  if (env.some((entry) => !allowed.has(entry.name))) return { source: 'legacy', reason: '包含未识别的 Claude Code 环境变量' };
  if (env.some((entry) => advancedNames.has(entry.name) && (entry.secret || entry.value === null))) return { source: 'legacy', reason: '旧高级变量无法可靠识别' };
  const base = env.find((entry) => entry.name === 'ANTHROPIC_BASE_URL');
  const auth = env.filter((entry) => ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'].includes(entry.name));
  if (!base?.value || base.secret || auth.length !== 1 || !auth[0].secret || auth[0].value !== null) return { source: 'legacy', reason: '服务地址或认证来源无法可靠识别' };
  if (!providerEndpointsSchema.safeParse({ anthropic: base.value }).success) return { source: 'legacy', reason: '旧服务地址无法安全转换' };
  const secretRef = `ai:${row.id}:env:${auth[0].name}`;
  if (!secretKeys.has(secretRef)) return { source: 'legacy', reason: '旧认证引用缺失，请保留旧配置修复' };
  const modelEntries = env.filter((entry) => modelNames.has(entry.name));
  if (modelEntries.some((entry) => entry.secret || !entry.value || entry.value.length > 256)) return { source: 'legacy', reason: '旧模型映射无法可靠识别' };
  const models = [...new Set(modelEntries.map((entry) => entry.value!))];
  const defaultModel = modelEntries.find((entry) => entry.name === 'ANTHROPIC_MODEL')?.value ?? (models.length === 1 ? models[0] : null);
  if (!defaultModel) return { source: 'legacy', reason: '旧配置未明确默认模型' };
  return { source: 'provider', endpoint: base.value, secretRef, authType: auth[0].name === 'ANTHROPIC_API_KEY' ? 'api-key' : 'bearer', models, defaultModel };
}

export interface AgentMigrationResult { migrated: string[]; legacy: string[]; skipped: string[] }

/** One atomic, idempotent metadata migration. Old IDs, tasks, env/args and ciphertext stay untouched. */
export function migrateAgentProfiles(db: AppDb, now = Date.now()): AgentMigrationResult {
  return db.transaction(() => {
    const result: AgentMigrationResult = { migrated: [], legacy: [], skipped: [] };
    const secretKeys = new Set(db.select({ key: appSecrets.key }).from(appSecrets).all().map((row) => row.key));
    const rows = db.select().from(aiProfiles).orderBy(asc(aiProfiles.createdAt), asc(aiProfiles.id)).all();
    const existing = db.select().from(aiRunConfigs).all();
    let order = Math.max(-1, ...existing.map((row) => row.sortOrder)) + 1;
    for (const row of rows) {
      if (existing.some((config) => config.profileId === row.id)) { result.skipped.push(row.id); continue; }
      const kind = row.runner;
      const executable = row.executable ?? row.runner;
      const toolId = `legacy-${kind}-${createHash('sha256').update(`${row.runner}\0${executable}`).digest('hex').slice(0, 24)}`;
      db.insert(aiTools).values({ id: toolId, kind, executable, customPath: row.executable, installed: false, login: 'none', createdAt: now, updatedAt: now })
        .onConflictDoNothing().run();
      let classification = classify(row, secretKeys);
      // No arbitrary winner: an existing conflicting normal combination leaves this whole row legacy.
      const others = db.select().from(aiRunConfigs).all();
      if (classification.source !== 'legacy' && others.some((config) => {
        if (config.source === 'legacy') return false;
        const other = rows.find((profile) => profile.id === config.profileId);
        return other?.name === row.name || (classification.source === 'login' && config.source === 'login' && config.toolId === toolId);
      })) classification = { source: 'legacy', reason: '与已有智能体名称或登录组合冲突，保留完整旧配置' };
      let providerId: string | null = null;
      if (classification.source === 'provider') {
        providerId = randomUUID();
        const models: ProviderModel[] = classification.models.map((id) => ({ id, name: id, contextWindow: null, offline: false, availability: { claude: 'untested', codex: 'untested' } }));
        const names = new Set(db.select({ name: aiProviders.name }).from(aiProviders).all().map((provider) => provider.name));
        let name = `${row.name}（迁移）`, suffix = 2;
        while (names.has(name)) name = `${row.name}（迁移 ${suffix++}）`;
        db.insert(aiProviders).values({ id: providerId, name, endpoints: JSON.stringify({ anthropic: classification.endpoint }), authType: classification.authType,
          secretRef: classification.secretRef, identityRevision: 1, models: JSON.stringify(models), recommended: JSON.stringify({ claude: classification.defaultModel }), createdAt: now, updatedAt: now }).run();
      }
      db.insert(aiRunConfigs).values({ profileId: row.id, toolId, source: classification.source, providerId,
        models: classification.source === 'provider' ? JSON.stringify(classification.models) : '[]',
        defaultModel: classification.source === 'provider' ? classification.defaultModel : null,
        // Only the known shipped login labels follow detected subscription/API.
        // Unknown historical names may be user choices and remain byte-exact.
        homeVisible: true, nameCustomized: classification.source!=='login'||!(row.runner==='claude'?['CC-work','Claude Code']:['Codex']).includes(row.name), sortOrder: order++, migrationVersion: 1,
        legacyReason: classification.source === 'legacy' ? classification.reason : null }).run();
      result[classification.source === 'legacy' ? 'legacy' : 'migrated'].push(row.id);
    }
    // Preserve the old default and its exact row; only presentation order is adjusted.
    const configs = db.select().from(aiRunConfigs).orderBy(asc(aiRunConfigs.sortOrder)).all();
    const originalDefault = rows.find((row) => row.isDefault);
    const ids = configs.map((config) => config.profileId);
    if (originalDefault && ids.includes(originalDefault.id)) {
      ids.splice(ids.indexOf(originalDefault.id), 1);
      ids.unshift(originalDefault.id);
    }
    ids.forEach((id, sortOrder) => db.update(aiRunConfigs).set({ sortOrder }).where(eq(aiRunConfigs.profileId, id)).run());
    return result;
  });
}
