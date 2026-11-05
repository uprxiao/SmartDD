// Controlled reference upstream. Synthetic credentials and local KV only; no network or user config.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const mode=process.argv[2],args=process.argv.slice(3),timers=new Map();
if(mode==='cli'&&args.length===1&&args[0]==='--version'){process.stdout.write('1.0.0\n');process.exit(0);}
const credential=JSON.parse(fs.readFileSync(process.env.WILLYOU_UPSTREAM_CREDENTIAL_FILE,'utf8')).credential;
if(typeof credential!=='string'||!credential.startsWith('SYNTHETIC_'))throw Error('Synthetic credentials required');
const root=process.env.WILLYOU_SAMPLE_DATA;if(!path.isAbsolute(root||''))throw Error('Controlled data directory required');fs.mkdirSync(root,{recursive:true,mode:0o700});
function audit(event){if(process.env.WILLYOU_SAMPLE_AUDIT)fs.appendFileSync(process.env.WILLYOU_SAMPLE_AUDIT,JSON.stringify({...event,pid:process.pid,home:process.env.HOME})+'\n',{mode:0o600});}
audit({event:'open',mode});
function invoke(name,input){
 if(!input||typeof input.key!=='string')throw Error('Invalid key');const file=path.join(root,crypto.createHash('sha256').update(input.key).digest('hex')+'.json');let old={key:input.key,value:null,revision:0,operationId:null};if(fs.existsSync(file))old=JSON.parse(fs.readFileSync(file,'utf8'));audit({event:'invoke',name,key:input.key,operationId:input.operationId??null});
 if(name==='kv_get')return old;
 if(name!=='kv_put'||typeof input.value!=='string'||typeof input.operationId!=='string')throw Error('Not mapped');
 if(old.operationId===input.operationId)return old;
 if(input.expectedRevision!==old.revision)throw Error('Revision conflict');
 const next={key:input.key,value:input.value,revision:old.revision+1,operationId:input.operationId};fs.writeFileSync(file,JSON.stringify(next),{mode:0o600});return next;
}
// Controlled fault data belongs only to this local reference service.
function delayFor(input){let control={};try{control=JSON.parse(fs.readFileSync(path.join(root,'control.json'),'utf8'));}catch{}const value=input.delayMs??control.delays?.[input.key]??0;return Number.isSafeInteger(value)&&value>=0&&value<=5000?value:0;}
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(mode==='cli'){
 const name=args[0],index=args.indexOf('--json');if(index!==1)throw Error('Fixed structured arguments required');const input=JSON.parse(args[2]),result=invoke(name,input);setTimeout(()=>{send(result);process.exit(0);},delayFor(input));
}else if(mode==='mcp'){
 const schema={type:'object',properties:{key:{type:'string'},value:{type:'string'},expectedRevision:{type:'integer'},operationId:{type:'string'},delayMs:{type:'integer'}},required:['key'],additionalProperties:false};
 readline.createInterface({input:process.stdin}).on('line',line=>{if(Buffer.byteLength(line)>262144)return process.exit(2);let req;try{req=JSON.parse(line);}catch{return process.exit(2);}
  const result=value=>send({jsonrpc:'2.0',id:req.id,result:value});
  if(req.method==='initialize')return result({protocolVersion:req.params.protocolVersion,serverInfo:{name:'WillYou reference KV',version:'1.0.0'},capabilities:{tools:{}}});
  if(req.method==='ping')return result({});
  if(req.method==='notifications/initialized')return;
  if(req.method==='notifications/cancelled'){const id=req.params.requestId,timer=timers.get(id);if(timer){clearTimeout(timer);timers.delete(id);audit({event:'canceled',requestId:id});}return;}
  if(req.method==='tools/list')return result({tools:['kv_get','kv_put','not_mapped'].map(name=>({name,description:'Synthetic '+name,inputSchema:schema,annotations:{readOnlyHint:name==='kv_get'}}))});
  if(req.method==='tools/call'){
   try{const input=req.params.arguments,value=invoke(req.params.name,input),timer=setTimeout(()=>{timers.delete(req.id);result({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false});},delayFor(input));timers.set(req.id,timer);}catch{result({content:[{type:'text',text:'Controlled upstream rejection'}],isError:true});}return;
  }
  if(req.id!==undefined)send({jsonrpc:'2.0',id:req.id,error:{code:-32601,message:'Not mapped'}});
 });
 process.stdin.on('close',()=>process.exit(0));
}else throw Error('Unsupported controlled mode');
