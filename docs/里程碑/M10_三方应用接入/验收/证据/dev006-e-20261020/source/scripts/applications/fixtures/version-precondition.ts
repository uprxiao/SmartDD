// Private acceptance setup only: install a complete old-version fixture through
// the real registry. This is not proof of a program upgrade or historical release.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import type {ApplicationManifest} from '../../../src/shared/applications';
async function main(){
const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3');
const userData=realpathSync(process.argv[2]);
if(!userData.startsWith('/private/tmp/willyou-m10-versions-ui-')||!userData.endsWith('/userdata'))throw new Error('Only this driver private fixture is allowed');
const db=new Database(join(userData,'smartdd.db'));
db.pragma('foreign_keys=ON');
try{
 const store=new ResourceStore(db,userData),registry=new PackageRegistry(store,'private-version-precondition'),active=registry.active('zentao');
 if(!active)throw new Error('Initial isolated App bootstrap is required');
 const current=registry.get(active.packageHash),manifest=structuredClone(current.manifest) as ApplicationManifest;
 manifest.version='0.9.0';manifest.description='Private acceptance old-version fixture; not a published release';
 const files=Object.fromEntries(manifest.files.map(file=>[file.path,readFileSync(join(store.root,current.relativePath,file.path))]));
 const previous=await registry.install({manifest,files});
 if(registry.active('zentao')?.packageHash!==current.packageHash)throw new Error('Fixture must not switch the real default');
 console.log(JSON.stringify({kind:'non-tested prerequisite',method:'real PackageRegistry.install of complete0.9.0 private fixture; no activation; not a program-upgrade test',storeId:store.storeId,oldHash:previous.packageHash,currentHash:current.packageHash,oldRelativePath:previous.relativePath}));
}finally{db.close();}
}void main().catch(error=>{process.stderr.write(String(error)+'\\n');process.exitCode=1;});
