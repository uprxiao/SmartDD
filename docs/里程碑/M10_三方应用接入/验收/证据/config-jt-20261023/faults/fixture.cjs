// Compiled acceptance-host fixture, never a user-loadable extension or RPC.
// Physical schema2 is synthetic. Actual host registry/view/context/Worker code
// still handles the fixed API1 tool. No encryption or approval policy is replaced.
const {z}=require('zod');
const {realpathSync,writeFileSync,existsSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {createHash}=require('node:crypto');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const stored=z.object({kind:z.literal('foxmail'),storage:z.object({path:z.string().min(1),account:z.string().min(1)}).strict(),range:z.object({days:z.number().int().min(1).max(100)}).strict(),access:z.enum(['local-readonly','protected-local-v2'])}).strict();
let legacy;
function guard(directory=process.env.SMARTDD_USER_DATA){
 if(!directory)throw Error('T59 private host requires its own explicit userData');
 const root=realpathSync(directory);
 if(!root.startsWith('/private/tmp/willyou-m10-config-upgrade-')||!root.endsWith('/userdata'))throw Error('Refusing T59 fixture outside this acceptance data directory');
 return root;
}
function native(value){
 if(value?.kind!=='foxmail'||!value.storage)return legacy.parse(value);
 const data=stored.parse(value);
 if(data.access!=='local-readonly')throw Error('Protected v2 source policy cannot be represented by old readonly API1');
 return{kind:'foxmail',sourcePath:data.storage.path,account:data.storage.account,queryDays:data.range.days};
}
function decorateDefinitions(definitions,legacySchema){
 legacy=legacySchema;
 definitions.providers=definitions.providers.map(provider=>provider.id!=='foxmail'?provider:{...provider,configSchemaVersion:2,configSchema:z.union([legacySchema,stored]),validateCandidate:(config,previous)=>provider.validateCandidate?.(native(config),previous?native(previous):null)});
}
function views(existing,Registry,legacySchema){
 legacy=legacySchema;
 const authentication=source=>source.storage?source.access:'local-readonly';
 const evolution=new Registry([{providerId:'foxmail',sourceSchemaVersion:2,targetApiMajor:1,identityContractMajor:1,implementationVersion:'fixture-jt-layout-2',sourceSchema:z.union([legacySchema,stored]),targetSchema:legacySchema,authModes:['local-readonly'],authentication,outputAuthentication:authentication,convert:native}]);
 // Preserve every compiled stock converter and its hash byte-for-byte.
 return Object.freeze({resolve(request,...args){const gate=join(guard(),'t59-converter-fault.txt');if(request.providerId==='foxmail'&&existsSync(gate)&&readFileSync(gate,'utf8')==='missing-converter')return new Registry([]).resolve(request,...args);return request.providerId==='foxmail'&&request.sourceSchemaVersion===2?evolution.resolve(request,...args):existing.resolve(request,...args);}});
}
function migrate(store){
 const root=guard();if(!resolve(store.sqlite.name).startsWith(root+'/'))throw Error('Fixture database is not inside the guarded userData');
 const changes=[];
 store.sqlite.transaction(()=>{
  for(const row of store.sqlite.prepare("SELECT id,config_json,config_schema_version,config_revision,revision,identity_revision FROM application_connections WHERE provider_id='foxmail' AND config_schema_version=1").all()){
   const before=native(JSON.parse(row.config_json)),after={kind:'foxmail',storage:{path:before.sourcePath,account:before.account},range:{days:before.queryDays??30},access:'local-readonly'};
   if(canonical(native(after))!==canonical(before))throw Error('Synthetic physical migration would change old API semantics');
   const outcome=store.sqlite.prepare('UPDATE application_connections SET config_json=?,config_schema_version=2,revision=revision+1,config_revision=config_revision+1 WHERE id=? AND revision=? AND config_schema_version=1').run(canonical(after),row.id,row.revision);if(outcome.changes!==1)throw Error('Fixture migration revision changed');
   changes.push({connectionId:row.id,fromSchema:1,toSchema:2,oldRevision:row.revision,newRevision:row.revision+1,identityRevision:row.identity_revision,beforeViewHash:hash(before),afterViewHash:hash(native(after)),physicalHash:hash(after)});
  }
 })();
 const file=join(root,'t59-compiled-format-migration.json');
 if(changes.length){if(existsSync(file))throw Error('Do not overwrite a prior private migration receipt');writeFileSync(file,JSON.stringify({fixture:'compiled T59 host only; not stock Foxmail schema2 support',changes},null,2)+'\n',{mode:0o600,flag:'wx'});}
}
module.exports={guard,decorateDefinitions,views,migrate};
