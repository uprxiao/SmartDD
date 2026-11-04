import type Database from 'better-sqlite3';
import { ApplicationError } from '@shared/applications';
import { createHash } from 'node:crypto';
import { browserInputProgressSchema } from './input-progress';
import {protectBrowserSummary} from './audit';
const sensitiveCommand=(command:string)=>/^(cookie (get|set)|storage |fill$|set (credentials|headers)$|exec$)/.test(command);

export interface BrowserOperation {
  run_id: string; request_id: string; task_id: string; page_id: string | null; command: string;
  state: 'accepted' | 'running' | 'succeeded' | 'failed' | 'unknown'; effect_state: string;
  progress: string | null; summary: string | null; error_code: string | null; created_at: number; updated_at: number;
}
export class BrowserOperations {
  constructor(private readonly db: Database.Database) {}
  recover(now = Date.now()): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE browser_operations SET state='unknown',effect_state='unknown',updated_at=? WHERE state IN ('accepted','running')").run(now);
      this.db.prepare('DELETE FROM browser_operations WHERE created_at < ?').run(now - 7 * 86400000);
      // Older development builds may have persisted a compatibility result
      // before the command-specific redaction was applied. Preserve identity,
      // timing and status while replacing only valid sensitive summaries.
      const update=this.db.prepare('UPDATE browser_operations SET summary=? WHERE run_id=? AND request_id=?');
      for(const row of this.db.prepare('SELECT * FROM browser_operations WHERE summary IS NOT NULL').iterate() as Iterable<BrowserOperation>){
        if(!sensitiveCommand(row.command))continue;
        let summary:unknown;try{summary=JSON.parse(row.summary!);}catch{continue;}
        try{const safe=JSON.stringify(protectBrowserSummary(row.command,summary,row.request_id.startsWith('audit:')));if(safe!==row.summary)update.run(safe,row.run_id,row.request_id);}catch{/* Preserve corrupt records for the read-only recovery error. */}
      }
    })();
  }
  get(runId: string, requestId: string): BrowserOperation | null {
    return this.db.prepare('SELECT * FROM browser_operations WHERE run_id=? AND request_id=?').get(runId, requestId) as BrowserOperation ?? null;
  }
  receipt(runId: string, requestId: string) {
    const row = this.get(runId, requestId);
    if (!row) return { state: 'not-found' };
    const state: 'succeeded' | 'failed' | 'unknown' = row.state === 'accepted' || row.state === 'running' ? 'unknown' : row.state;
    const value:unknown=row.summary===null?null:JSON.parse(row.summary),summary=sensitiveCommand(row.command)?protectBrowserSummary(row.command,value,row.request_id.startsWith('audit:')):value;
    return { requestId: row.request_id, pageId: row.page_id, command: row.command, state, effectState: row.effect_state,
      progress: row.progress === null ? null : browserInputProgressSchema.parse(JSON.parse(row.progress)),
      summary, errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  begin(runId: string, requestId: string, taskId: string, pageId: string | null, command: string): { operation: BrowserOperation; replay: boolean } {
    return this.db.transaction(() => {
      const previous = this.get(runId, requestId);
      if (previous) {
        if (previous.task_id !== taskId || previous.command !== command || previous.page_id !== pageId)
          throw new ApplicationError('REQUEST_CONFLICT', '请求编号已属于另一浏览器操作');
        return { operation: previous, replay: true };
      }
      const now = Date.now();
      this.db.prepare("INSERT INTO browser_operations(run_id,request_id,task_id,page_id,command,state,effect_state,created_at,updated_at) VALUES(?,?,?,?,?,'accepted','not-started',?,?)")
        .run(runId, requestId, taskId, pageId, command, now, now);
      return { operation: this.get(runId, requestId)!, replay: false };
    })();
  }
  update(runId: string, requestId: string, state: BrowserOperation['state'], effect: string, detail: { progress?: unknown; summary?: unknown; code?: string } = {}): void {
    const bounded = (value: unknown): string | null => {
      if (value === undefined) return null;
      const json = JSON.stringify(value), bytes = Buffer.byteLength(json);
      return bytes <= 65536 ? json : JSON.stringify({ omitted: true, bytes, sha256: createHash('sha256').update(json).digest('hex') });
    };
    const command=this.get(runId,requestId)?.command;
    const protectedSummary=detail.summary!==undefined&&!requestId.startsWith('audit:')&&command&&sensitiveCommand(command)?protectBrowserSummary(command,detail.summary):detail.summary;
    this.db.prepare('UPDATE browser_operations SET state=?,effect_state=?,progress=?,summary=?,error_code=?,updated_at=? WHERE run_id=? AND request_id=?')
      .run(state, effect, bounded(detail.progress), bounded(protectedSummary), detail.code ?? null, Date.now(), runId, requestId);
  }
  page(runId:string,requestId:string,pageId:string):void{this.db.prepare('UPDATE browser_operations SET page_id=? WHERE run_id=? AND request_id=?').run(pageId,runId,requestId);}
}
