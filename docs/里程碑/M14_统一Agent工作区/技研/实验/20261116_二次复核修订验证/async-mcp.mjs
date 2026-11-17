// Trusted research MCP. Async delegation returns a receipt; observe returns the result.
import {createInterface} from 'node:readline';
const [endpoint,ticket]=process.argv.slice(2);
for(const k of ['DEEPSEEK_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY'])delete process.env[k];
const tools=[
 {name:'wy_delegate',description:'Queue one child agent. Returns immediately. A writing child starts only after your current turn ends; do not wait or poll.',inputSchema:{type:'object',properties:{target:{type:'string',enum:['codex','claude']},task:{type:'string'},clientRequestId:{type:'string'}},required:['target','task','clientRequestId'],additionalProperties:false}},
 {name:'wy_observe',description:'Read the completed result for a previously queued child. Use only after the host notifies you it completed.',inputSchema:{type:'object',properties:{delegationId:{type:'string'}},required:['delegationId'],additionalProperties:false}},
];
const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\n');
process.stdin.on('end',()=>process.exit(0));
createInterface({input:process.stdin}).on('line',async line=>{
 let x;try{x=JSON.parse(line);}catch{return;}
 if(x.method==='initialize')return send({id:x.id,result:{protocolVersion:x.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'m14-async',version:'1'}}});
 if(x.method==='tools/list')return send({id:x.id,result:{tools}});
 if(x.method==='tools/call'){
  try{
   const r=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+ticket,'content-type':'application/json'},body:JSON.stringify(x.params),signal:AbortSignal.timeout(10000)});
   const body=await r.json();return send({id:x.id,result:{content:[{type:'text',text:JSON.stringify(body)}],...(r.ok?{}:{isError:true})}});
  }catch(e){return send({id:x.id,result:{content:[{type:'text',text:String(e)}],isError:true}});}
 }
 if(x.id!==undefined)send({id:x.id,result:{}});
});
