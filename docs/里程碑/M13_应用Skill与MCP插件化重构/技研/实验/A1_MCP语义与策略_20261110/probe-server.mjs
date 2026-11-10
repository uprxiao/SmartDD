import {appendFileSync} from 'node:fs';import readline from 'node:readline';
const LOG=process.env.WY_PROBE_LOG||'/tmp/m13-a1/probe.log';
appendFileSync(LOG,JSON.stringify({kind:'start',argv:process.argv.slice(2),cwd:process.cwd(),env:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(A_|B_|C_|D_|E_|API_KEY|ANTHROPIC_|WY_|WILLYOU_|OPENAI_|TARGET)/.test(k)))})+'\n');
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
readline.createInterface({input:process.stdin}).on('line',l=>{let m;try{m=JSON.parse(l)}catch{return}
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'wy_echo',description:'e',inputSchema:{type:'object',properties:{}}},{name:'wy_write',description:'w',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.method==='tools/call'){appendFileSync(LOG,JSON.stringify({kind:'call',tool:m.params?.name,server:process.argv[2]||null})+'\n');send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'CALLED '+m.params?.name}]}});}
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,result:{}});});
