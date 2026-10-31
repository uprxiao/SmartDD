// Reuses version-precondition.ts setup: real registry, complete nondefault bundle.
// This fixture prepares data only; cleanup and recovery use the unmodified App.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';

async function main(){
 const userData=realpathSync(process.argv[2]);
 if(!userData.startsWith('/private/tmp/willyou-m10-gc-crash-')||!userData.endsWith('/userdata'))throw Error('Only this driver private fixture is allowed');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));
 db.pragma('foreign_keys=ON');
 try{
  const store=new ResourceStore(db,userData),registry=new PackageRegistry(store,'private-gc-precondition'),active=registry.active('zentao');
  if(!active)throw Error('Initial App bootstrap required');
  const current=registry.get(active.packageHash),manifest=structuredClone(current.manifest);
  manifest.version='0.9.0';manifest.description='Private cleanup fault fixture; never activated or published';
  const files=Object.fromEntries(manifest.files.map(file=>[file.path,readFileSync(join(store.root,current.relativePath,file.path))]));
  const previous=await registry.install({manifest,files});
  if(registry.active('zentao')?.packageHash!==current.packageHash)throw Error('Do not replace actual default');
  console.log(JSON.stringify({layer:'Non-tested prerequisite: complete unused package installed by actual registry, not a native historical session',storeId:store.storeId,oldHash:previous.packageHash,currentHash:current.packageHash,oldRelativePath:previous.relativePath}));
 }finally{db.close();}
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
