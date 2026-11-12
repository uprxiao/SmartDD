import {randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, openSync, closeSync, constants, fsyncSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {ApplicationError, APP_HASH_PATTERN} from '@shared/applications';
import {pluginManifestSchema, type PluginManifest} from '@shared/plugins';
import {ensureStoreDirectory} from '../package-files';
import {ownedBundle, verifyOwnedBundle, writeOwnedBundle} from '../owned-bundle';
import {canonicalJson} from '../manifest';
import type {ResourceStore} from '../resource-store';
import {inspectPluginDirectory, validatePluginBundle, type ValidatedPlugin} from './package';

interface PackageRow {
  package_hash:string;bundle_hash:string;app_id:string;version:string;relative_path:string;manifest_json:string;created_at:string;
}
export interface StoredPlugin {
  plugin:ValidatedPlugin;directory:string;bundleHash:string;relativePath:string;
}
const durable = (path:string) => {const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};

/** External packages have their own owned tree; they never enter the compiled built-in trust registry. */
export class PluginPackageStore {
  readonly root:string;
  constructor(readonly store:ResourceStore) {
    const userData=dirname(store.root), root=join(userData,'plugins');let created=false;
    try{mkdirSync(root,{mode:0o700});created=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    if(lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory()||realpathSync(root)!==root)throw new ApplicationError('OWNERSHIP_CONFLICT','插件库路径归属不明');
    this.root=root;const marker=join(root,'.willyou-plugin-store.json');
    if(created){writeFileSync(marker,canonicalJson({schema:1,storeId:store.storeId})+'\n',{flag:'wx',mode:0o600});durable(marker);durable(root);}
    this.assertOwner();
  }
  private assertOwner():void {
    try{
      const marker=join(this.root,'.willyou-plugin-store.json'),stat=lstatSync(marker);
      if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.size>4096||realpathSync(this.root)!==this.root)throw new Error();
      const value=JSON.parse(readFileSync(marker,'utf8'));
      if(value.schema!==1||value.storeId!==this.store.storeId)throw new Error();
    }catch{throw new ApplicationError('OWNERSHIP_CONFLICT','插件库归属与当前数据不符，保留原目录');}
  }
  private expected(row:PackageRow):string {
    if(!APP_HASH_PATTERN.test(row.package_hash)||!APP_HASH_PATTERN.test(row.bundle_hash))throw new ApplicationError('HASH_MISMATCH','插件包记录无效');
    const manifest=pluginManifestSchema.safeParse(JSON.parse(row.manifest_json));
    if(!manifest.success||manifest.data.id!==row.app_id||manifest.data.version!==row.version)throw new ApplicationError('HASH_MISMATCH','插件包声明记录不符');
    const relative=`packages/${row.app_id}/${row.version}/${row.package_hash}`;
    if(row.relative_path!==relative)throw new ApplicationError('OWNERSHIP_CONFLICT','插件包目录记录不符');
    return join(this.root,relative);
  }
  private restoreInterruptedRemoval(row:PackageRow,directory:string):void {
    const trash=join(this.root,'trash',row.package_hash);
    if(existsSync(directory)||!existsSync(trash))return;
    this.store.sqlite.transaction(()=>{
      if(!this.store.sqlite.prepare('SELECT 1 FROM plugin_packages WHERE package_hash=? AND bundle_hash=?').get(row.package_hash,row.bundle_hash))throw new ApplicationError('RESOURCE_STATE_CHANGED','插件清理记录已变化');
      verifyOwnedBundle(trash,row.bundle_hash,this.store.storeId);
      ensureStoreDirectory(this.root,dirname(row.relative_path));
      if(!existsSync(directory)){renameSync(trash,directory);durable(dirname(directory));durable(dirname(trash));}
    }).immediate();
  }
  get(hash:string):StoredPlugin {
    this.assertOwner();
    const row=this.store.sqlite.prepare('SELECT * FROM plugin_packages WHERE package_hash=?').get(hash) as PackageRow|undefined;
    if(!row)throw new ApplicationError('NOT_FOUND','插件包尚未安装');
    const directory=this.expected(row);this.restoreInterruptedRemoval(row,directory);verifyOwnedBundle(directory,row.bundle_hash,this.store.storeId);
    const plugin=inspectPluginDirectory(join(directory,'payload'));
    if(plugin.hash!==row.package_hash||canonicalJson(plugin.manifest)!==row.manifest_json)throw new ApplicationError('HASH_MISMATCH','插件包与安装记录不符');
    return{plugin,directory:join(directory,'payload'),bundleHash:row.bundle_hash,relativePath:row.relative_path};
  }
  list():{hash:string;manifest:PluginManifest}[] {
    this.assertOwner();
    return(this.store.sqlite.prepare('SELECT package_hash,manifest_json FROM plugin_packages ORDER BY app_id,version').all() as Pick<PackageRow,'package_hash'|'manifest_json'>[]).map(row=>({hash:row.package_hash,manifest:pluginManifestSchema.parse(JSON.parse(row.manifest_json))}));
  }
  /** Materialize and verify outside the SQLite write transaction, then atomically publish the owned tree. */
  publish(candidate:ValidatedPlugin):StoredPlugin {
    this.assertOwner();const plugin=validatePluginBundle(candidate.files,undefined,candidate.executables);
    if(plugin.hash!==candidate.hash)throw new ApplicationError('HASH_MISMATCH','检查后的插件来源已变化，请重新检查');
    if(this.store.sqlite.prepare('SELECT 1 FROM plugin_packages WHERE package_hash=?').get(plugin.hash))return this.get(plugin.hash);
    const relative=`packages/${plugin.manifest.id}/${plugin.manifest.version}/${plugin.hash}`,target=join(this.root,relative);
    const stage=join(ensureStoreDirectory(this.root,'staging'),randomUUID());
    const bundle=ownedBundle({pluginHash:plugin.hash,appId:plugin.manifest.id,version:plugin.manifest.version},Object.fromEntries([...plugin.files].map(([path,bytes])=>['payload/'+path,bytes])),new Set([...plugin.executables].map(path=>'payload/'+path)));
    let renamed=false;
    try{
      writeOwnedBundle(stage,bundle,this.store.storeId);verifyOwnedBundle(stage,bundle.hash,this.store.storeId);
      this.store.sqlite.transaction(()=>{
        this.assertOwner();
        if(this.store.sqlite.prepare('SELECT 1 FROM plugin_packages WHERE package_hash=?').get(plugin.hash))return;
        ensureStoreDirectory(this.root,dirname(relative));
        if(existsSync(target)) {
          // A crash after rename but before SQL commit can leave this exact owned candidate. Never replace other content.
          verifyOwnedBundle(target,bundle.hash,this.store.storeId);
        }else{renameSync(stage,target);renamed=true;durable(dirname(target));durable(dirname(stage));}
        this.store.sqlite.prepare('INSERT INTO plugin_packages(package_hash,bundle_hash,app_id,version,relative_path,manifest_json,created_at) VALUES(?,?,?,?,?,?,?)').run(plugin.hash,bundle.hash,plugin.manifest.id,plugin.manifest.version,relative,canonicalJson(plugin.manifest),new Date().toISOString());
      }).immediate();
      return this.get(plugin.hash);
    }finally{
      if(!renamed&&existsSync(stage)){verifyOwnedBundle(stage,bundle.hash,this.store.storeId);rmSync(stage,{recursive:true});}
    }
  }
  removeUnused(hash:string):boolean {
    this.assertOwner();
    const row=this.store.sqlite.prepare('SELECT * FROM plugin_packages WHERE package_hash=?').get(hash) as PackageRow|undefined;
    if(!row)return false;
    const directory=this.expected(row),trash=join(ensureStoreDirectory(this.root,'trash'),hash);
    this.restoreInterruptedRemoval(row,directory);let moved=false;
    try{
      this.store.sqlite.transaction(()=>{
        const active=this.store.sqlite.prepare('SELECT 1 FROM plugin_installations WHERE package_hash=?').get(hash);
        const changing=this.store.sqlite.prepare("SELECT 1 FROM plugin_lifecycle_changes WHERE (from_hash=? OR to_hash=?) AND state IN ('preparing','prepared','swapping','recovery-required')").get(hash,hash);
        const running=this.store.sqlite.prepare("SELECT 1 FROM plugin_runtime_leases WHERE package_hash=? AND state<>'closed'").get(hash);
        if(active||changing||running)throw new ApplicationError('RESOURCE_BUSY','插件包仍被安装、进程或变更引用');
        verifyOwnedBundle(directory,row.bundle_hash,this.store.storeId);
        if(existsSync(trash)){verifyOwnedBundle(trash,row.bundle_hash,this.store.storeId);rmSync(trash,{recursive:true});}
        renameSync(directory,trash);moved=true;durable(dirname(directory));durable(dirname(trash));
        this.store.sqlite.prepare("DELETE FROM plugin_runtime_leases WHERE package_hash=? AND state='closed'").run(hash);
        this.store.sqlite.prepare('DELETE FROM plugin_packages WHERE package_hash=?').run(hash);
      }).immediate();
    }catch(error){
      if(moved)this.restoreInterruptedRemoval(row,directory);
      throw error;
    }
    rmSync(trash,{recursive:true});durable(dirname(trash));return true;
  }
}
