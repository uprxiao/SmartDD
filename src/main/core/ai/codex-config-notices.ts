import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { agentRunSnapshotSchema } from '@shared/agent-run-state';
import type { AppDb } from '../../db/client';
import { aiTaskSnapshots } from '../../db/schema';

/** Outstanding settings notices from existing local history; never opens a task. */
export function codexConfigNotices(db: AppDb) {
  const read = (text: string) => {
    try {
      const result = agentRunSnapshotSchema.safeParse(JSON.parse(text));
      return result.success ? result.data : null;
    } catch { return null; }
  };
  const load = (id: string) => {
    const row = db.select().from(aiTaskSnapshots).where(eq(aiTaskSnapshots.taskId, id)).get();
    return row ? read(row.snapshot) : null;
  };
  return {
    list: () => db.select().from(aiTaskSnapshots).all().flatMap(row => {
      const notice = read(row.snapshot)?.codexGlobal;
      return notice?.changed && !notice.dismissed ? [{ taskId: row.taskId, ...notice }] : [];
    }),
    dismiss: (id: string) => {
      const snapshot = load(id);
      if (snapshot?.codexGlobal?.changed && !snapshot.codexGlobal.dismissed) {
        const value = { ...snapshot, codexGlobal: { ...snapshot.codexGlobal, dismissed: true } };
        db.update(aiTaskSnapshots).set({ snapshot: JSON.stringify(value) }).where(eq(aiTaskSnapshots.taskId, id)).run();
      }
    },
    path: (id: string) => {
      const snapshot = load(id);
      if (!snapshot?.codexGlobal?.changed || snapshot.codexGlobal.path !== join(snapshot.stateRoot, 'config.toml')) {
        throw new Error('没有可打开的 Codex 配置记录');
      }
      return snapshot.codexGlobal.path;
    },
  };
}
