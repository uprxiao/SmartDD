import { desc, eq, isNotNull } from 'drizzle-orm';
import type { SessionRecord } from '@shared/types';
import type { AppDb } from './client';
import { sessions } from './schema';

export function listSessions(db: AppDb): SessionRecord[] {
  return db.select().from(sessions).orderBy(desc(sessions.createdAt)).all();
}

export function insertSession(db: AppDb, s: SessionRecord): void {
  db.insert(sessions).values(s).run();
}

export function setNativeSessionId(db: AppDb, id: string, nativeId: string): void {
  db.update(sessions).set({ nativeSessionId: nativeId }).where(eq(sessions.id, id)).run();
}

export function claimedNativeIds(db: AppDb): Set<string> {
  const rows = db
    .select({ id: sessions.nativeSessionId })
    .from(sessions)
    .where(isNotNull(sessions.nativeSessionId))
    .all();
  return new Set(rows.map((r) => r.id as string));
}
