import {createInterface} from 'node:readline';
const [endpoint,ticket]=process.argv.slice(2);
for(const k of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'])delete process.env[k];
for await(const line of createInterface({input:process.stdin})){
 let m;try{m=JSON.parse(line);}catch{continue;}if(m.id===undefined)continue;
 const send=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
 if(m.method==='initialize')send({protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'steer-gate',version:'1'}});
 else if(m.method==='tools/list')send({tools:[{name:'wait_gate',description:'Wait for the experiment host to release a gate. Call once.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
 else if(m.method==='tools/call'){
  const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+ticket},signal:AbortSignal.timeout(90000)});
  send({content:[{type:'text',text:await response.text()}],isError:!response.ok});
 }else send({});
}
