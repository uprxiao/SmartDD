import { isAbsolute, join, resolve } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { encodeClaudeDir } from '../tasks/native-sessions';
import { codexSkillDiscoveryEvidence } from './codex-skill-discovery-evidence';
import { codexSkillReadEvidence, type SkillReadObservation, type SkillReadTarget } from './codex-skill-read-evidence';

export interface NativeEvidenceIdentity {
  readonly root: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly realCwd: string;
}
export interface NativeEvidenceLookup {
  /** Host-owned bounded enumeration and non-link directory checks. */
  names(path: string): Promise<string[]>;
  directory(path: string): Promise<void>;
  isFile(path: string): Promise<boolean>;
}
export interface ParsedNativeUserMessage { text: string; timestamp: number }
type SkillEvidenceParser = (lines: readonly string[], targets: readonly SkillReadTarget[], since: number, through: number) => SkillReadObservation[];

/** Compiled, trusted format implementations. They receive native identity and
 * bounded records, never business data, credentials or PTY authorization receipts.
 * Opening, budgets, inode/header rechecks and authorization remain in the host. */
export interface NativeEvidenceAdapter {
  readonly id: string;
  locate(identity: NativeEvidenceIdentity, lookup: NativeEvidenceLookup): Promise<string>;
  validateHeader?(value: unknown, identity: NativeEvidenceIdentity): boolean;
  parseUserMessage?(value: unknown, identity: NativeEvidenceIdentity): ParsedNativeUserMessage | null;
  observeSkillReads?: SkillEvidenceParser;
  observeSkillDiscoveries?: SkillEvidenceParser;
}

function message(content: unknown, kind: string, timestamp: number, plainText = false): ParsedNativeUserMessage | null {
  if (plainText && typeof content === 'string') return { text: content, timestamp };
  if (!Array.isArray(content) || !content.length || content.some(part => !part || typeof part !== 'object' || part.type !== kind || typeof part.text !== 'string')) return null;
  return { text: content.map(part => part.text).join('\n'), timestamp };
}
const timestampOf = (value: any) => typeof value?.timestamp === 'string' ? Date.parse(value.timestamp) : NaN;

const claude = Object.freeze<NativeEvidenceAdapter>({
  id: 'claude-code',
  async locate(identity, lookup) {
    const projects = join(identity.root, 'projects'); await lookup.directory(projects);
    const found: string[] = [];
    for (const cwd of new Set([identity.cwd, identity.realCwd])) {
      const dir = join(projects, encodeClaudeDir(cwd));
      try { await lookup.directory(dir); const file = join(dir, identity.sessionId + '.jsonl'); if (await lookup.isFile(file)) found.push(file); }
      catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    }
    const unique = [...new Set(found)];
    if (unique.length !== 1) throw new ApplicationError('SOURCE_UNAVAILABLE', '未找到唯一的本会话原生消息文件');
    return unique[0];
  },
  parseUserMessage(value: any, identity) {
    const timestamp = timestampOf(value);
    if (!Number.isFinite(timestamp) || value.type !== 'user' || value.message?.role !== 'user' || value.sessionId !== identity.sessionId || typeof value.cwd !== 'string' || !isAbsolute(value.cwd) || ![resolve(identity.cwd), identity.realCwd].includes(resolve(value.cwd)) || value.isMeta === true || value.isSidechain === true || value.toolUseResult !== undefined) return null;
    if ((value.isMeta !== undefined && typeof value.isMeta !== 'boolean') || (value.isSidechain !== undefined && typeof value.isSidechain !== 'boolean')) return null;
    return message(value.message.content, 'text', timestamp, true);
  },
});

const codex = Object.freeze<NativeEvidenceAdapter>({
  id: 'codex',
  async locate(identity, lookup) {
    const sessions = join(identity.root, 'sessions'), found: string[] = [];
    for (const year of (await lookup.names(sessions)).filter(name => /^\d{4}$/.test(name))) {
      for (const month of (await lookup.names(join(sessions, year))).filter(name => /^(0[1-9]|1[0-2])$/.test(name))) {
        for (const day of (await lookup.names(join(sessions, year, month))).filter(name => /^(0[1-9]|[12]\d|3[01])$/.test(name))) {
          const dir = join(sessions, year, month, day);
          for (const name of await lookup.names(dir)) if (name.startsWith('rollout-') && name.endsWith('-' + identity.sessionId + '.jsonl')) found.push(join(dir, name));
        }
      }
    }
    if (found.length !== 1) throw new ApplicationError('SOURCE_UNAVAILABLE', '未找到唯一的本会话原生消息文件');
    return found[0];
  },
  validateHeader(value: any, identity) {
    return value?.type === 'session_meta' && value.payload?.id === identity.sessionId && typeof value.payload?.cwd === 'string' && isAbsolute(value.payload.cwd) && [resolve(identity.cwd), identity.realCwd].includes(resolve(value.payload.cwd));
  },
  parseUserMessage(value: any) {
    const timestamp = timestampOf(value);
    if (!Number.isFinite(timestamp) || value.type !== 'response_item' || value.payload?.type !== 'message' || value.payload.role !== 'user') return null;
    // Harness-injected role=user context is not the user's own message.
    const meta = value.payload.internal_chat_message_metadata_passthrough;
    if (meta !== undefined && (!Array.isArray(meta?.content_item_metadata) || !meta.content_item_metadata.length || meta.content_item_metadata.some((item: any) => item?.provenance?.type !== 'user'))) return null;
    return message(value.payload.content, 'input_text', timestamp);
  },
  observeSkillReads: codexSkillReadEvidence,
  observeSkillDiscoveries: codexSkillDiscoveryEvidence,
});

/** Startup-only composition. An unknown Agent never falls through to a Codex parser. */
export class NativeEvidenceAdapterRegistry {
  private readonly adapters: ReadonlyMap<string, NativeEvidenceAdapter>;
  constructor(entries: readonly NativeEvidenceAdapter[]) {
    const adapters = new Map<string, NativeEvidenceAdapter>();
    for (const entry of entries) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) || adapters.has(entry.id) || typeof entry.locate !== 'function' || ['validateHeader','parseUserMessage','observeSkillReads','observeSkillDiscoveries'].some(key => (entry as any)[key] !== undefined && typeof (entry as any)[key] !== 'function')) throw new Error('原生证据适配器声明无效或重复');
      adapters.set(entry.id, Object.freeze(entry));
    }
    this.adapters = adapters;
  }
  get(id: string): NativeEvidenceAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED', '当前Agent没有已登记的原生证据格式');
    return adapter;
  }
  list(): readonly NativeEvidenceAdapter[] { return [...this.adapters.values()]; }
}
export const builtinNativeEvidenceAdapters = new NativeEvidenceAdapterRegistry([claude, codex]);
