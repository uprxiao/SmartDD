// TR: session approval gate for one isolated PostgreSQL read-only acceptance batch.
// Reading a plan or passing pure validation is not authorization to start an App.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const DATABASE_SQL_SCOPE='TR_T67_POSTGRES_READONLY_20261030';
export const DATABASE_SQL_REPLY='允许本次隔离数据库验证';
export const DATABASE_SQL_DIR='/private/tmp/willyou-m10-tr-20261030';
const issued=new WeakSet();
const hash=b=>createHash('sha256').update(b).digest('hex');

export function validateDatabaseSqlApproval(record,expected){
  assert(record&&record.approved===true&&record.source==='explicit-user-reply','TR requires an actual explicit user reply');
  assert.equal(record.scope,DATABASE_SQL_SCOPE,'An SSH/send/other approval does not cover TR');
  assert.equal(record.replyText,DATABASE_SQL_REPLY);
  assert(typeof record.questionReference==='string'&&record.questionReference.length>8,'Missing original question/reply reference');
  assert.equal(record.maxSqlAttempts,3);
  assert.equal(record.expectedPinsSha256,expected.pinsSha256,'Approval must refer to this exact reviewable input set');
  return true;
}

export function requireDatabaseSqlPermission(){
  const expectedBytes=readFileSync(join(DATABASE_SQL_DIR,'expected-pins.json'));
  const expected=JSON.parse(expectedBytes);
  assert.equal(expected.scope,DATABASE_SQL_SCOPE);
  for(const[path,sha256]of Object.entries(expected.inputs))assert.equal(hash(readFileSync(path)),sha256,'TR input changed: '+path);
  const path=join(DATABASE_SQL_DIR,'approval.json'),stat=lstatSync(path);
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16384&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'TR approval must be an owned private regular file');
  const bytes=readFileSync(path),record=JSON.parse(bytes);
  const pinsSha256=hash(expectedBytes);
  validateDatabaseSqlApproval(record,{pinsSha256});
  const permission=Object.freeze({scope:DATABASE_SQL_SCOPE,pinsSha256,approvalSha256:hash(bytes),questionReference:record.questionReference});
  issued.add(permission);return permission;
}

export function reserveDatabaseSqlRead(permission,label,run){
  assert(issued.has(permission),'Only a verified actual approval can reserve an attempt');
  const current=requireDatabaseSqlPermission();
  assert.equal(current.approvalSha256,permission.approvalSha256);
  const index=['initial','resumed','App-restarted'].indexOf(label);
  assert(index>=0,'Only the three reviewed recovery phases are allowed');
  const record={scope:permission.scope,approvalSha256:permission.approvalSha256,pinsSha256:permission.pinsSha256,label,run,at:new Date().toISOString()};
  // Each phase is durable across retries. Never clear/recreate an occupied budget.
  writeFileSync(join(DATABASE_SQL_DIR,'sql-attempt-'+(index+1)+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  return record;
}
