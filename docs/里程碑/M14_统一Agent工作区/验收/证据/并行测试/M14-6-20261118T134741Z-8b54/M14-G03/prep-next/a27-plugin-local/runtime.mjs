import assert from 'node:assert/strict';
import {closeSync,constants,fsyncSync,lstatSync,openSync,realpathSync,writeSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

const appId='a27-local-effect';
const capability=appId+'.record.write';
const marker='A27_LOCAL_DURABLE_NO_REPLY';
const inherited=process.env.WILLYOU_PLUGIN_DATA;
const validUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const lineInput=createInterface({input:process.stdin});
const reply=(id,value)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result:value})+'\n');
const bad=id=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32602,message:'Isolated A27 fixture input refused'}})+'\n');
function privateData() {
  const scoped=/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/(?:attempt-[0-9]+\/runtime-[A-Za-z0-9]+\/data|prep-next\/a27-plugin-local\/raw-[A-Za-z0-9]+)\/plugin-data\/a27-local-effect$/;
  assert(scoped.test(inherited??'')&&realpathSync(inherited)===inherited&&lstatSync(inherited).isDirectory());
  return inherited;
}
function persist(root,name,flags,value) {
  const fd=openSync(join(root,name),flags | constants.O_NOFOLLOW,0o600);
  try {
    const bytes=Buffer.from(JSON.stringify(value)+'\n');
    assert.equal(writeSync(fd,bytes),bytes.length);
    fsyncSync(fd);
  } finally {closeSync(fd);}
}
lineInput.on('line', line=>{
  let frame;
  try {frame=JSON.parse(line);}catch{return;}
  if(frame.method==='initialize') {
    reply(frame.id,{protocol:'jsonrpc-stdio/1',plugin:appId,version:'0.1.0'});
    return;
  }
  const {input,connection,scope}=frame.params??{};
  if(frame.method!=='execute'||frame.params?.capability!==capability||input?.marker!==marker||
    !connection||Object.keys(connection).length||scope?.callerKind!=='agent'||!validUuid(scope.operationId)||!validUuid(scope.runId)||
    typeof scope.projectId!=='string'||!scope.projectId) {bad(frame.id);return;}
  try {
    const data=privateData();
    const effect={marker,operationId:scope.operationId,runId:scope.runId,projectId:scope.projectId,pid:process.pid};
    persist(data,'attempts.jsonl',constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND,effect);
    persist(data,'effect.json',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,effect);
    const directory=openSync(data,constants.O_RDONLY);
    try {fsyncSync(directory);} finally {closeSync(directory);}
    persist(data,'effect-flushed.json',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,{operationId:scope.operationId,runId:scope.runId});
    // Withhold the reply. The normal parent pipe closes on the specific host crash.
  } catch {bad(frame.id);}
});
lineInput.once('close',()=>process.exit(0));
