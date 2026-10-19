import { eq } from 'drizzle-orm';
import type { AppDb } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import { FileError, fileScopeSchema, type FileScope } from '@shared/files';
import { fileScopeKey, fileWorkspaceSchema, WORKSPACE_STATE_BYTES, type SavedFileWorkspace, type WorkspaceSnapshot, type WorkspaceCommit } from '@shared/file-workspace';

/** Reuses the application database's settings key/value table. Each scope is a
 * separate key, outside SettingsStore's fixed global settings keys. SQLite's
 * synchronous commit completes before IPC acknowledges a route update. No file
 * contents, leases, undo state, or resource URLs are persisted here. */
export class FileWorkspacePersistence {
  constructor(private readonly db: AppDb) {}
  private key(scope: FileScope): string { return `fileWorkspace.v1:${fileScopeKey(fileScopeSchema.parse(scope))}`; }
  load(scope: FileScope): SavedFileWorkspace | null {
    return this.snapshot(scope).state;
  }
  private decode(row: { value: string; updatedAt: number } | undefined): WorkspaceSnapshot {
    if (!row) return { state: null, revision: 0 };
    try {
      if (Buffer.byteLength(row.value) > WORKSPACE_STATE_BYTES || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw new Error('invalid record');
      return { state: fileWorkspaceSchema.parse(JSON.parse(row.value)), revision: row.updatedAt };
    } catch { throw new FileError('IO', '已保存的文件标签记录无法读取；原记录仍保留'); }
  }
  snapshot(scope: FileScope): WorkspaceSnapshot {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, this.key(scope))).get();
    return this.decode(row);
  }
  save(scope: FileScope, state: SavedFileWorkspace): void {
    const key = this.key(scope), value = JSON.stringify(fileWorkspaceSchema.parse(state));
    if (Buffer.byteLength(value) > WORKSPACE_STATE_BYTES) throw new FileError('TOO_LARGE', '文件标签与目录状态超过 4 MiB，当前界面仍保留');
    // Internal migration/test seeding may replace an unreadable record. Renderer
    // writes use commit(), where revision checking and the write are atomic.
    const previous = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
    this.db.insert(appSettings).values({ key, value, updatedAt })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } }).run();
  }
  commit(scope: FileScope, state: SavedFileWorkspace, expectedRevision: number): WorkspaceCommit {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new FileError('INVALID_INPUT', '标签状态版本无效');
    const key = this.key(scope), parsed = fileWorkspaceSchema.parse(state), value = JSON.stringify(parsed);
    if (Buffer.byteLength(value) > WORKSPACE_STATE_BYTES) throw new FileError('TOO_LARGE', '文件标签与目录状态超过 4 MiB，当前界面仍保留');
    return this.db.transaction(tx => {
      const current = this.decode(tx.select().from(appSettings).where(eq(appSettings.key, key)).get());
      if (current.revision !== expectedRevision) return { ...current, accepted: false };
      if (current.state && JSON.stringify(current.state) === value) return { ...current, accepted: true };
      const revision = Math.max(Date.now(), current.revision + 1);
      if (!Number.isSafeInteger(revision)) throw new FileError('IO', '标签状态版本已超过可用范围');
      tx.insert(appSettings).values({ key, value, updatedAt: revision }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: revision } }).run();
      return { state: parsed, revision, accepted: true };
    });
  }
}
