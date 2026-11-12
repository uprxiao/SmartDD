import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {ApplicationError,APP_HASH_PATTERN} from '@shared/applications';
import {canonicalJson,digest} from '../manifest';
import {syncPluginPath} from './data-tree';
import {ZENTAO_RESOURCE_TABLE_SQL} from '../../../../../plugins/zentao/src/storage';

/** Host-only one-time export; only legal Zentao resource metadata is projected, never credentials or other applications. */
export const ZENTAO_LEGACY_TABLES=[
  'application_zentao_revisions','application_zentao_files','application_zentao_cursors',
  'application_zentao_operation_objects','application_zentao_operation_resources',
] as const;
export const ZENTAO_PRIVATE_DATABASE='zentao.sqlite';
type TableName=typeof ZENTAO_LEGACY_TABLES[number]|'plugin_resources';
type Cell=null|string|number|bigint|Buffer;
interface TableDefinition {name:TableName;sql:string;indexes:{name:string;sql:string}[];columns:string[];keys:string[]}
export interface LegacyTableProof {name:TableName;rows:number;hash:string;schemaHash:string}
export interface LegacyZentaoImport {tables:readonly LegacyTableProof[];sourceHash:string;beforeCommit(dataDirectory:string):void}
const MAX_BYTES=1024*1024*1024,MAX_ROWS=2000000;
const quoted=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function controlsStamp(db:Database.Database):string {
  const entries=[['application_catalog_state','app_id'],['application_connections','id'],['application_project_settings','project_id'],['application_project_bindings','project_id,slot'],['application_binding_slot_revisions','project_id,slot']];
  const values=entries.map(([name,order])=>db.prepare(`SELECT * FROM ${quoted(name)} WHERE app_id='zentao' ORDER BY ${order.split(',').map(quoted).join(',')}`).raw(true).safeIntegers(true).all());
  return digest(JSON.stringify(values,(_key,value)=>typeof value==='bigint'?{integer:value.toString()}:value));
}
function readonlySeals():{name:string;sql:string}[]{
  const rows:{name:string;sql:string}[]=[];
  for(const table of ZENTAO_LEGACY_TABLES)for(const operation of ['INSERT','UPDATE','DELETE']){
    const name='willyou_m13_legacy_'+table+'_'+operation.toLowerCase();rows.push({name,sql:`CREATE TRIGGER ${quoted(name)} BEFORE ${operation} ON ${quoted(table)} BEGIN SELECT RAISE(ABORT,'Legacy Zentao data is read-only after plugin migration'); END`});
  }
  for(const operation of ['INSERT','UPDATE','DELETE']){
    const name='willyou_m13_legacy_resource_index_'+operation.toLowerCase();rows.push({name,sql:`CREATE TRIGGER ${quoted(name)} BEFORE ${operation} ON application_data_resources WHEN ${operation==='UPDATE'?"OLD.app_id='zentao' OR NEW.app_id='zentao'":(operation==='INSERT'?'NEW':'OLD')+".app_id='zentao'"} BEGIN SELECT RAISE(ABORT,'Legacy Zentao resources are read-only after plugin migration'); END`});
  }
  return rows;
}
/** Explicit delete-data only. The surrounding uninstall SQL transaction restores rows and seals on any later failure. */
export function deleteLegacyZentaoCopies(source:Database.Database):void {
  if(!source.inTransaction)throw new ApplicationError('INVALID_INPUT','旧禅道数据清理必须与卸载处于同一事务');
  const marker=source.prepare("SELECT migration_version FROM plugin_builtin_migrations WHERE app_id='zentao'").get() as {migration_version:number}|undefined;
  if(!marker)return;
  if(marker.migration_version!==1)throw new ApplicationError('CONFIG_INCOMPATIBLE','旧禅道数据迁移版本不兼容，保留原数据');
  const seals=readonlySeals();
  for(const seal of seals){const row=source.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(seal.name) as {sql:string}|undefined;if(row?.sql!==seal.sql)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','旧禅道数据保护状态无法核验，保留原数据');}
  for(const seal of seals)source.exec(`DROP TRIGGER ${quoted(seal.name)}`);
  source.prepare("DELETE FROM application_data_resources WHERE app_id='zentao'").run();
  for(const name of ['application_zentao_operation_objects','application_zentao_files','application_zentao_cursors','application_zentao_operation_resources','application_zentao_revisions'])source.exec(`DELETE FROM ${quoted(name)}`);
  for(const seal of seals)source.exec(seal.sql);
  // Keep the immutable migration marker: a reinstall must never re-import deleted history.
}
function definition(db:Database.Database,name:TableName):TableDefinition {
  const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as {sql:string}|undefined;
  const columns=db.prepare(`PRAGMA table_info(${quoted(name)})`).all() as {name:string;pk:number}[];
  if(!table?.sql||!columns.length||!columns.some(c=>c.pk))throw new ApplicationError('CONFIG_INCOMPATIBLE','禅道旧表结构不完整，保留原数据');
  const indexes=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(name) as {name:string;sql:string}[];
  return{name,sql:table.sql,indexes,columns:columns.map(c=>c.name),keys:columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name)};
}
function scan(db:Database.Database,table:TableDefinition,budget:{bytes:number;rows:number},copy?:(row:Cell[])=>void,query?:string):LegacyTableProof {
  const hash=createHash('sha256');let rows=0;
  const statement=db.prepare(query??`SELECT ${table.columns.map(quoted).join(',')} FROM ${quoted(table.name)} ORDER BY ${table.keys.map(quoted).join(',')}`).raw(true).safeIntegers(true);
  for(const row of statement.iterate() as Iterable<Cell[]>){
    if(++budget.rows>MAX_ROWS)throw new ApplicationError('TOO_LARGE','禅道迁移行数超过预算，原数据未改变');
    hash.update('row:');
    for(const value of row){
      const type=value===null?'null':Buffer.isBuffer(value)?'blob':typeof value;
      const bytes=value===null?Buffer.alloc(0):Buffer.isBuffer(value)?value:Buffer.from(String(value));
      budget.bytes+=bytes.length;
      if(budget.bytes>MAX_BYTES)throw new ApplicationError('TOO_LARGE','禅道迁移数据超过预算，原数据未改变');
      hash.update(type+':'+bytes.length+':');hash.update(bytes);
    }
    copy?.(row);rows++;
  }
  return{name:table.name,rows,hash:hash.digest('hex'),schemaHash:digest(canonicalJson(table))};
}
const legacyResourceQuery=`SELECT g.resource_id,g.project_id,z.connection_id,z.identity_revision,g.object_id,g.object_revision,g.part,g.content_hash,g.byte_size,g.media_type FROM application_data_resources g JOIN application_zentao_revisions z ON z.object_key=g.object_id AND z.project_id=g.project_id WHERE g.app_id='zentao' ORDER BY g.resource_id`;
function assertLegacyResources(db:Database.Database){if(db.prepare("SELECT 1 FROM application_data_resources g WHERE g.app_id='zentao' AND (g.backing_kind<>'zentao-object-v1' OR g.data_contract_major<>1 OR g.permission<>'zentao.read' OR NOT EXISTS(SELECT 1 FROM application_zentao_revisions z WHERE z.object_key=g.object_id AND z.project_id=g.project_id AND z.representation='detail')) LIMIT 1").get())throw new ApplicationError('CONFIG_INCOMPATIBLE','旧禅道资源来源不兼容，保留原实现');}
function proofs(db:Database.Database,legacyResourceDefinition?:TableDefinition):LegacyTableProof[]{const budget={bytes:0,rows:0},rows=ZENTAO_LEGACY_TABLES.map(name=>scan(db,definition(db,name),budget));if(legacyResourceDefinition){assertLegacyResources(db);rows.push(scan(db,legacyResourceDefinition,budget,undefined,legacyResourceQuery));}else rows.push(scan(db,definition(db,'plugin_resources'),budget));return rows;}
function privateFile(directory:string):{path:string;dev:number;ino:number}{
  if(realpathSync(directory)!==directory||!lstatSync(directory).isDirectory())throw new ApplicationError('OWNERSHIP_CONFLICT','禅道候选目录归属无效');
  const path=join(directory,ZENTAO_PRIVATE_DATABASE),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_BYTES+64*1024*1024||realpathSync(path)!==path)throw new ApplicationError('OWNERSHIP_CONFLICT','禅道私有数据库归属或大小无效');return{path,dev:stat.dev,ino:stat.ino};}finally{closeSync(fd);}
}
/** Called only inside the lifecycle-owned candidate, before its initialization probe; activation invokes beforeCommit after promotion. */
export function prepareLegacyZentaoData(source:Database.Database,candidate:string,packageHash:string,options:{afterTable?(name:TableName):void}={}):LegacyZentaoImport|undefined {
  if(!APP_HASH_PATTERN.test(packageHash)||source.inTransaction)throw new ApplicationError('INVALID_INPUT','禅道迁移必须在宿主事务外准备');
  const previous=source.prepare("SELECT migration_version FROM plugin_builtin_migrations WHERE app_id='zentao'").get() as {migration_version:number}|undefined;
  if(previous){if(previous.migration_version!==1)throw new ApplicationError('CONFIG_INCOMPATIBLE','禅道迁移版本不兼容');return;}
  if(realpathSync(candidate)!==candidate||!lstatSync(candidate).isDirectory())throw new ApplicationError('OWNERSHIP_CONFLICT','禅道候选数据目录无效');
  const path=join(candidate,ZENTAO_PRIVATE_DATABASE),fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);closeSync(fd);
  const target=new Database(path);let tables:LegacyTableProof[],resourceDefinition:TableDefinition,controlHash:string;
  try{
    target.pragma('foreign_keys=ON');target.pragma('journal_mode=DELETE');target.pragma('synchronous=FULL');
    tables=source.transaction(()=>target.transaction(()=>{
      controlHash=controlsStamp(source);
      const budget={bytes:0,rows:0},result:LegacyTableProof[]=[];
      for(const name of ZENTAO_LEGACY_TABLES){
        const table=definition(source,name);target.exec(table.sql);for(const index of table.indexes)target.exec(index.sql);
        const insert=target.prepare(`INSERT INTO ${quoted(name)} (${table.columns.map(quoted).join(',')}) VALUES (${table.columns.map(()=>'?').join(',')})`);
        result.push(scan(source,table,budget,row=>{insert.run(...row);}));options.afterTable?.(name);
      }
      assertLegacyResources(source);target.exec(ZENTAO_RESOURCE_TABLE_SQL);resourceDefinition=definition(target,'plugin_resources');
      const insertResource=target.prepare('INSERT INTO plugin_resources VALUES(?,?,?,?,?,?,?,?,?,?)');result.push(scan(source,resourceDefinition,budget,row=>{insertResource.run(...row);},legacyResourceQuery));options.afterTable?.('plugin_resources');
      if(target.prepare('PRAGMA foreign_key_check').all().length)throw new ApplicationError('HASH_MISMATCH','禅道私有数据关联校验失败');
      const actual=proofs(target);if(canonicalJson(actual)!==canonicalJson(result))throw new ApplicationError('HASH_MISMATCH','禅道迁移逐表核对失败');
      target.exec('CREATE TABLE willyou_legacy_import (migration_version INTEGER PRIMARY KEY,package_hash TEXT NOT NULL,source_hash TEXT NOT NULL,tables_json TEXT NOT NULL)');
      target.prepare('INSERT INTO willyou_legacy_import VALUES(1,?,?,?)').run(packageHash,digest(canonicalJson(result)),canonicalJson(result));return result;
    }).immediate()).deferred();
  }finally{target.close();}
  syncPluginPath(path);syncPluginPath(candidate);
  const identity=privateFile(candidate),tablesJson=canonicalJson(tables),sourceHash=digest(tablesJson);
  return{tables,sourceHash,beforeCommit(dataDirectory){
    if(!source.inTransaction)throw new ApplicationError('INVALID_INPUT','禅道迁移确认须与插件激活在同一事务');
    if(source.prepare("SELECT 1 FROM plugin_builtin_migrations WHERE app_id='zentao'").get())throw new ApplicationError('REVISION_CONFLICT','禅道迁移已由其他宿主完成');
    if(controlsStamp(source)!==controlHash)throw new ApplicationError('REVISION_CONFLICT','迁移期间原连接或项目设置发生变化，已保留其他修改');
    if(canonicalJson(proofs(source,resourceDefinition))!==tablesJson)throw new ApplicationError('REVISION_CONFLICT','迁移期间旧禅道数据发生变化，已保留原实现');
    const current=privateFile(dataDirectory);if(current.ino!==identity.ino||current.dev!==identity.dev)throw new ApplicationError('OWNERSHIP_CONFLICT','禅道候选数据库被替换');
    const verified=new Database(current.path,{readonly:true,fileMustExist:true});
    try{
      verified.pragma('query_only=ON');
      const marker=verified.prepare('SELECT * FROM willyou_legacy_import').all();
      if(canonicalJson(marker)!==canonicalJson([{migration_version:1,package_hash:packageHash,source_hash:sourceHash,tables_json:tablesJson}])||canonicalJson(proofs(verified))!==tablesJson||verified.prepare('PRAGMA foreign_key_check').all().length)throw new ApplicationError('HASH_MISMATCH','插件初始化改变了迁移副本，原数据未改变');
    }finally{verified.close();}
    for(const seal of readonlySeals())source.exec(seal.sql);
    source.prepare('INSERT INTO plugin_builtin_migrations VALUES(?,?,?,?,?,?)').run('zentao',1,packageHash,sourceHash,tablesJson,new Date().toISOString());
  }};
}
