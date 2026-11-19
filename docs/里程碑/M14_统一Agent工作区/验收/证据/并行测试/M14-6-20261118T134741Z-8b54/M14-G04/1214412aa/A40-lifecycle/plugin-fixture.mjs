import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const pluginId='a40-lifecycle-fixture';
export const displayName='A40 Lifecycle Fixture';
export const originalCapability=pluginId+'.proof.read';
export const breakingCapability=pluginId+'.proof.replacement';
export const skillPath='skills/a40-proof';
export const resourceFile='references/proof.txt';
export const toolName=capability=>'smartdd_p'+createHash('sha256').update(capability).digest('hex').slice(0,16)+'_v1';
export const fixtureVersions=Object.freeze({
  original:{version:'1.0.0',hostApi:1,capability:originalCapability},
  compatible:{version:'1.1.0',hostApi:1,capability:originalCapability},
  breaking:{version:'2.0.0',hostApi:1,capability:breakingCapability},
  unsupported:{version:'3.0.0',hostApi:99,capability:breakingCapability},
});
export const relativeMarker=version=>'A40_RELATIVE_SKILL_'+version.replaceAll('.','_');
export const runtimeMarker=version=>'A40_RUNTIME_'+version.replaceAll('.','_');
export const validLabel=label=>typeof label==='string'&&/^[a-z][a-z0-9_-]{1,47}$/.test(label);

function makeRuntime(version,capability) {
  return `import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as wait } from 'node:timers/promises';
const root=process.env.WILLYOU_PLUGIN_DATA;
if (typeof root!=='string'||process.cwd()!==root||process.env.WILLYOU_PLUGIN_ID!==${JSON.stringify(pluginId)})
  throw Error('Missing own plugin data directory');
const marker=${JSON.stringify(runtimeMarker(version))},version=${JSON.stringify(version)};
const send=(id,key,value)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,[key]:value})+'\\n');
async function onRequest(packet) {
  if (packet.method==='initialize') return send(packet.id,'result',{
    protocol:'jsonrpc-stdio/1',plugin:${JSON.stringify(pluginId)},version,
  });
  const label=packet.params?.input?.label,scope=packet.params?.scope;
  if(packet.method!=='execute'||packet.params.capability!==${JSON.stringify(capability)}||
    !(typeof label==='string'&&/^[a-z][a-z0-9_-]{1,47}$/.test(label))||
    scope?.callerKind!=='agent'||typeof scope?.runId!=='string'||typeof scope?.operationId!=='string')
    return send(packet.id,'error',{code:-32000,message:'Expected only the isolated native task call',data:{code:'INVALID_INPUT'}});
  const record={label,version,marker,runId:scope.runId,operationId:scope.operationId,pid:process.pid,at:Date.now()};
  const retained=join(root,'a40-retained.txt');
  if(!existsSync(retained))writeFileSync(retained,'A40_PRIVATE_DATA_MUST_SURVIVE\\n',{flag:'wx',mode:0o600});
  writeFileSync(join(root,label+'.arrived.json'),JSON.stringify(record),{flag:'wx',mode:0o600});
  if(label.startsWith('hold_')){
    const ticket=join(root,label+'.release'),deadline=Date.now()+26000;
    while(!existsSync(ticket)&&Date.now()<deadline)await wait(25);
    if(!existsSync(ticket)||readFileSync(ticket,'utf8')!==scope.operationId)
      return send(packet.id,'error',{code:-32000,message:'Fixture release absent or mismatched',data:{code:'TIMEOUT'}});
  }
  record.returnedAt=Date.now();
  writeFileSync(join(root,label+'.returned.json'),JSON.stringify(record),{flag:'wx',mode:0o600});
  send(packet.id,'result',{label,version,status:marker});
}
createInterface({input:process.stdin}).on('line',line=>{
  const packet=JSON.parse(line);
  void onRequest(packet).catch(error=>send(packet.id,'error',{code:-32000,message:String(error),data:{code:'INVALID_INPUT'}}));
});
`;
}

export function buildPluginFixture(root,kind){
  assert.match(root,/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}\/runtime-[A-Za-z0-9]+\/fixtures$/);
  const selected=Object.hasOwn(fixtureVersions,kind)&&fixtureVersions[kind];
  assert(selected,'Expected known fixture version');
  const {version,hostApi,capability}=selected;
  const directory=join(root,kind);
  mkdirSync(directory,{mode:0o700});
  const manifest={
    schema:'willyou-plugin/v0-draft2',id:pluginId,version,hostApi,displayName,
    description:'Synthetic plugin lifecycle fixture using only its own private data.',
    permissions:[],providers:[],
    capabilities:{[capability]:{title:'Read synthetic A40 lifecycle marker',permission:capability,
      semantics:'read',retry:'safe-read',slots:[],input:'schemas/input.json',output:'schemas/output.json'}},
    runtime:{type:'process',entry:'runtime/main.mjs',protocol:'jsonrpc-stdio/1'},skills:['skills'],ui:{panels:[]},
  };
  const skill='---\nname: a40-proof\ndescription: Read the version-specific A40 relative resource.\n---\n\nRead [the isolated relative reference](./'+resourceFile+').\n';
  const payload={
    '.willyou-plugin/plugin.json':JSON.stringify(manifest,null,2)+'\n',
    'schemas/input.json':JSON.stringify({type:'object',additionalProperties:false,properties:{label:{type:'string'}},required:['label']})+'\n',
    'schemas/output.json':JSON.stringify({type:'object',additionalProperties:false,
      properties:{label:{type:'string'},version:{type:'string'},status:{type:'string'}},required:['label','version','status']})+'\n',
    'runtime/main.mjs':makeRuntime(version,capability),
    [skillPath+'/SKILL.md']:skill,
    [skillPath+'/'+resourceFile]:relativeMarker(version)+'\n',
  };
  for(const [relative,text]of Object.entries(payload)){
    const path=join(directory,relative);
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    writeFileSync(path,text,{flag:'wx',mode:0o600});
  }
  return{directory,version,capability,hostApi,files:Object.fromEntries(Object.entries(payload)
    .map(([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')]))};
}
