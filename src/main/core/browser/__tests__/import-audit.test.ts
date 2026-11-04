import {afterEach,describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {BrowserCookieImportAudit} from '../cookie-import/audit';
import {BrowserOperations} from '../operations';
import {BrowserCookieSourceError} from '../cookie-import/chromium-source';
const databases:Database.Database[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture(){const db=new Database(':memory:');databases.push(db);db.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));const operations=new BrowserOperations(db);return{db,operations,audit:new BrowserCookieImportAudit(operations),rows:()=>db.prepare('SELECT * FROM browser_operations').all() as Record<string,unknown>[]};}
describe('user Cookie workflow audit (actual SQLite, no native I)',()=>{
  it('records user/task/profile/time/result while never serializing returned Cookie values or source paths',async()=>{
    const f=fixture(),secret={value:'synthetic-secret-cookie',path:'/private/source/profile'};expect(await f.audit.run('task1','profile1','import',async()=>{expect(f.rows()[0]).toMatchObject({task_id:'task1',state:'running'});return secret;})).toBe(secret);const row=f.rows()[0];expect(row).toMatchObject({task_id:'task1',command:'ui cookie import',state:'succeeded',effect_state:'completed'});expect(JSON.parse(String(row.summary))).toEqual({actor:'user',projectId:null,profileId:'profile1',action:'import'});expect(row.created_at).toBeGreaterThan(0);expect(JSON.stringify(f.rows())).not.toMatch(/synthetic-secret-cookie|private\/source/);
  });
  it('records exact fixed source failure reason without raw error details and never retries the action',async()=>{
    const f=fixture();let calls=0;await expect(f.audit.run('task1','profile1','import',async()=>{calls++;throw new BrowserCookieSourceError('keychain-denied','private error must not reach audit');})).rejects.toThrow('private error');expect(calls).toBe(1);expect(f.rows()[0]).toMatchObject({state:'failed',effect_state:'not-started',error_code:'keychain-denied'});expect(JSON.stringify(f.rows())).not.toContain('private error');
  });
  it('keeps interrupted/ambiguous actions unknown and isolates separate user sessions from CLI receipts',async()=>{
    const f=fixture();await expect(f.audit.run('task1','profile1','recover',async()=>{throw Error('private failure');})).rejects.toThrow('private failure');expect(f.rows()[0]).toMatchObject({state:'unknown',effect_state:'unknown',command:'ui cookie recover'});const second=new BrowserCookieImportAudit(f.operations);await second.run('task1','profile1','clear',async()=>{});const rows=f.rows();expect(rows[0].run_id).not.toBe(rows[1].run_id);expect(JSON.stringify(rows)).not.toContain('private failure');
  });
});
