import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { setImmediate as afterIO } from 'node:timers/promises';
import { DriverError, type DriverModel } from '../driver';
import type { JsonlRpcPeer } from '../jsonl-rpc';

interface ModelPage {
  data: {
    model?: string; id?: string; displayName?: string; isDefault?: boolean; hidden?: boolean;
    supportedReasoningEfforts?: { reasoningEffort: string }[]; defaultReasoningEffort?: string;
  }[];
  nextCursor?: string | null;
}
export interface CodexCatalogResult { models: DriverModel[]; confirmed: boolean }
export interface CatalogObserver {
  account?(fingerprint: string | undefined): void;
  fallback?(models: DriverModel[]): void;
}

// account/read returns public metadata. Only its digest can identify a saved WillYou catalogue.
export async function catalogAccount(peer: JsonlRpcPeer): Promise<string | undefined> {
  const { account } = await peer.call<{ account?: { type: string; email?: string; planType?: string; accountId?: string } }>(
    'account/read', { refreshToken: false }, 3500);
  if (account?.type !== 'chatgpt' || !(account.accountId || account.email)) return undefined;
  return createHash('sha256').update(JSON.stringify([account.accountId, account.email, account.planType])).digest('hex');
}

export class CodexCatalogReader {
  private refreshFailed = false;
  constructor(private readonly peer: JsonlRpcPeer, stderr?: Readable | null) {
    // Codex can successfully reply with its built-in models after a failed network refresh.
    if (stderr) createInterface({ input: stderr, crlfDelay: Infinity }).on('line', line => {
      if (line.includes('failed to refresh available models')) this.refreshFailed = true;
    });
  }

  private async pages(timeoutMs: number) {
    const models = new Map<string, DriverModel>(), cursors = new Set<string>();
    const deadline = Date.now() + timeoutMs;
    let cursor: string | undefined;
    do {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DriverError('TIMEOUT', '读取模型目录超时');
      const page: ModelPage = await this.peer.call('model/list', { limit: 200, ...(cursor ? { cursor } : {}) }, remaining);
      if (!Array.isArray(page?.data)) throw new DriverError('PROTOCOL', 'Codex 模型目录格式无效');
      for (const m of page.data) {
        const id = m?.model ?? m?.id;
        if (m?.hidden || typeof id !== 'string' || !id || id.length > 256 || models.has(id)) continue;
        const efforts = Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts
          .map(e => e?.reasoningEffort).filter(e => typeof e === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(e)).slice(0, 12) : [];
        models.set(id, { id, name: (typeof m.displayName === 'string' ? m.displayName : id).slice(0, 160),
          efforts: [...new Set(efforts)], defaultEffort: typeof m.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort.slice(0, 24) : undefined,
          ...(m.isDefault === true ? { isDefault: true } : {}) });
        if (models.size === 200) return [...models.values()];
      }
      cursor = page.nextCursor ?? undefined;
      if (cursor && (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 200)) throw new DriverError('PROTOCOL', 'Codex 模型目录分页无效');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...models.values()];
  }

  async read(onFallback?: (models: DriverModel[]) => void, { attempts = 3, timeoutMs = 12_000 } = {}): Promise<CodexCatalogResult> {
    let fallback: DriverModel[] | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let models: DriverModel[];
      // Opening a thread can log its own refresh failure before this request.
      this.refreshFailed = false;
      try { models = await this.pages(timeoutMs); }
      catch (error) { if (fallback) break; throw error; }
      await afterIO(); // stderr and stdout are separate pipes.
      if (!this.refreshFailed) return { models, confirmed: true };
      fallback = models;
      onFallback?.(models);
    }
    return { models: fallback ?? [], confirmed: false };
  }
}
