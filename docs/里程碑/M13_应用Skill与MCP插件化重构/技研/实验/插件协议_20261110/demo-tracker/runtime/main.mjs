// Demo plugin runtime: JSON-RPC 2.0 over stdio (newline-delimited). No dependencies.
import readline from 'node:readline'; import {readFileSync} from 'node:fs';
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
const rl=readline.createInterface({input:process.stdin});
const handlers={
  initialize:()=>({protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:'0.1.0',pid:process.pid}),
  verify:async({config,secret})=>{const r=await fetch(config.baseUrl+'/api/me',{headers:{authorization:'Bearer '+secret}});if(!r.ok)throw new Error('verify failed '+r.status);return {identity:(await r.json()).account};},
  execute:async({capability,input,connection})=>{
    if(capability!=='demo-tracker.bugs.list')throw new Error('unknown capability');
    const mode=input.mode||'normal';
    if(mode==='crash')process.exit(3);
    if(mode==='hang')return new Promise(()=>{});
    if(mode==='probe'){let read=false,err=null;try{readFileSync(input.probePath);read=true}catch(e){err=e.code}
      return {bugs:[],probe:{envKeys:Object.keys(process.env).sort(),readHostFile:read,readError:err,cwd:process.cwd()}};}
    const u=new URL(connection.config.baseUrl+'/api/bugs');u.searchParams.set('assignee',connection.config.account);u.searchParams.set('status',input.status||'active');
    const r=await fetch(u,{headers:{authorization:'Bearer '+connection.secret}});if(!r.ok)throw new Error('upstream '+r.status);
    const bugs=(await r.json()).slice(0,input.limit||100);
    if(mode==='bad-output')return {bugs:bugs.map(b=>({...b,severity:'high'}))};
    return {bugs};
  }};
rl.on('line',async l=>{let m;try{m=JSON.parse(l)}catch{return}
  try{const h=handlers[m.method];if(!h)throw new Error('method not found');send({jsonrpc:'2.0',id:m.id,result:await h(m.params||{})});}
  catch(e){send({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:String(e.message||e)}});}});
