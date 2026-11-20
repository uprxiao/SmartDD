import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';

export const appId='a72-tier-fixture';
export const caps={read:appId+'.note.read',open:appId+'.note.write',ask:appId+'.note.write.asked'};
export const marker='A72_TIER_NOTE';
export const toolName=cap=>'smartdd_p'+createHash('sha256').update(cap).digest('hex').slice(0,16)+'_v1';
const schemaIn={type:'object',additionalProperties:false,required:['marker','label'],properties:{marker:{const:marker},label:{type:'string',pattern:'^A72_[A-Za-z0-9_-]{1,64}$'}}};
export const manifest={schema:'willyou-plugin/v0-draft2',id:appId,version:'0.1.0',hostApi:1,
  displayName:'A72 档位合成插件',description:'本地合成数据：一个读取、一个写入（未声明上限）、一个写入（上限为请求批准）。每次写入在插件私有目录留下一条唯一记录。',
  permissions:[],providers:[],skills:[],
  capabilities:{
    [caps.read]:{title:'读取 A72 合成记录数',semantics:'read',permission:appId+'.read',retry:'safe-read',slots:[],input:'schemas/in.json',output:'schemas/read-out.json'},
    [caps.open]:{title:'写入 A72 合成记录（未声明上限）',semantics:'write',permission:appId+'.write',retry:'never',slots:[],input:'schemas/in.json',output:'schemas/write-out.json'},
    [caps.ask]:{title:'写入 A72 合成记录（上限请求批准）',semantics:'write',permission:appId+'.write',retry:'never',maxTier:'ask',slots:[],input:'schemas/in.json',output:'schemas/write-out.json'},
  },
  runtime:{type:'process',entry:'runtime/main.mjs',protocol:'jsonrpc-stdio/1'},ui:{panels:[]},
};
const runtime=`import {closeSync,constants,fsyncSync,mkdirSync,openSync,readdirSync,realpathSync,writeSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
const caps=${JSON.stringify(caps)};
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
const failed=(id,message)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32032,message}})+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
  let frame;try{frame=JSON.parse(line);}catch{return;}
  if(frame.method==='initialize'){reply(frame.id,{protocol:'jsonrpc-stdio/1',plugin:${JSON.stringify(appId)},version:'0.1.0'});return;}
  try{
    const root=process.env.WILLYOU_PLUGIN_DATA;
    if(!root||!root.startsWith('/private/tmp/willyou-m14-stage6.WRvdST/g03/')||realpathSync(root)!==root)throw Error('unexpected plugin data root');
    const p=frame.params,dir=join(root,'effects');mkdirSync(dir,{recursive:true,mode:0o700});
    if(frame.method!=='execute'||p.input.marker!==${JSON.stringify(marker)})throw Error('unexpected call');
    if(p.capability===caps.read){reply(frame.id,{count:readdirSync(dir).length});return;}
    if(p.capability!==caps.open&&p.capability!==caps.ask)throw Error('unknown capability');
    const {operationId,runId,taskId,callerKind}=p.scope;
    const fd=openSync(join(dir,operationId+'.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{const b=Buffer.from(JSON.stringify({operationId,runId,taskId:taskId??null,callerKind,capability:p.capability,label:p.input.label,pid:process.pid,at:new Date().toISOString()}));writeSync(fd,b);fsyncSync(fd);}finally{closeSync(fd);}
    reply(frame.id,{recorded:true});
  }catch(error){failed(frame.id,String(error.message??error).slice(0,200));}
});
`;
export function buildPlugin(root){
  assert(root.startsWith('/private/tmp/willyou-m14-stage6.WRvdST/g03/attempt-')&&!root.includes('/../'));
  const put=(rel,value)=>{const f=join(root,rel);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
  put('.willyou-plugin/plugin.json',manifest);
  put('schemas/in.json',schemaIn);
  put('schemas/read-out.json',{type:'object',additionalProperties:false,required:['count'],properties:{count:{type:'integer',minimum:0}}});
  put('schemas/write-out.json',{type:'object',additionalProperties:false,required:['recorded'],properties:{recorded:{const:true}}});
  put('runtime/main.mjs',runtime);
  return root;
}
