// Public synthetic P1 fixture. No network, host imports or real credentials.
import readline from 'node:readline';
import {existsSync,readFileSync,writeFileSync,renameSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';

const fixture=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url),'utf8'));
const root=process.env.WILLYOU_PLUGIN_DATA;
if(!root)throw Error('Private plugin data root required');
const file=join(root,'items.json'),started=join(root,'started.jsonl');
const save=items=>{const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(items));renameSync(tmp,file);};
const load=()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const response=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
const error=(id,code)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32000,message:'Public synthetic fixture refused',data:{code}}})+'\n');
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize'){
  if(fixture.failInitialize){save([{id:'bad',title:'BAD CANDIDATE',body:'Must be rolled back'}]);response(m.id,{protocol:'controlled-invalid',plugin:'demo-tracker',version:fixture.version});return;}
  if(!existsSync(file))save([{id:'1',title:'P1 原始待办 中文🙂',body:'P1 合成详情：只能读写本插件的私有目录。'}]);
  response(m.id,{protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:fixture.version});return;
 }
 if(m.method==='verify'){
  if(m.params.provider!=='demo-local'||!['token','password'].includes(m.params.authMode)||m.params.secret!=='P1_PUBLIC_ONLY'){error(m.id,'AUTH_REQUIRED');return;}
  response(m.id,{identity:{serviceId:'p1-demo-local',accountId:m.params.config.account}});return;
 }
 if(m.method!=='execute'){error(m.id,'INVALID_INPUT');return;}
 const {capability,input,connection}=m.params;
 const account=connection?.['demo-local']?.config?.account;
 if(typeof account!=='string'){error(m.id,'AUTH_REQUIRED');return;}
 appendFileSync(started,JSON.stringify({version:fixture.version,capability,account,delayMs:input.delayMs??0})+'\n');
 if(input.mode==='crash')process.exit(7);
 if(input.delayMs)await new Promise(resolve=>setTimeout(resolve,input.delayMs));
 const items=load();
 if(capability==='demo-tracker.items.add'){
  const id=String(Math.max(0,...items.map(i=>Number(i.id)||0))+1);
  items.push({id,title:input.title,body:'P1 合成新增待办'});save(items);
 }
 if(capability==='demo-tracker.items.get'){
  const row=items.find(i=>i.id===input.id);
  if(!row){error(m.id,'NOT_FOUND');return;}
  response(m.id,{fields:{...row,version:fixture.version,account}});return;
 }
 if(!['demo-tracker.items.list','demo-tracker.items.add'].includes(capability)){error(m.id,'INVALID_INPUT');return;}
 response(m.id,{version:fixture.version,account,items:items.map(({id,title})=>({id,title}))});
});
