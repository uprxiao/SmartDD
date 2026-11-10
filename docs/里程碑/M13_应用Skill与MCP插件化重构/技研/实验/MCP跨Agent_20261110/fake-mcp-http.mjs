// minimal streamable-HTTP MCP server (JSON responses); requires Bearer argv[3]; logs to argv[2]; prints port
import http from 'node:http';import {appendFileSync} from 'node:fs';
const LOG=process.argv[2],TOKEN=process.argv[3];
const s=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{
 const authOk=q.headers.authorization==='Bearer '+TOKEN;appendFileSync(LOG,JSON.stringify({kind:'http-req',method:q.method,authOk,hasAuth:!!q.headers.authorization})+'\n');
 if(q.method!=='POST'){r.writeHead(405);r.end();return;}
 if(!authOk){r.writeHead(401,{'content-type':'application/json'});r.end('{"error":"unauthorized"}');return;}
 let m;try{m=JSON.parse(Buffer.concat(c))}catch{r.writeHead(400);r.end();return;}
 if(m.id===undefined){r.writeHead(202);r.end();return;}
 let result={};
 if(m.method==='initialize')result={protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'wy-fake-http',version:'1'}};
 else if(m.method==='tools/list')result={tools:[{name:'wy_echo',description:'http echo',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 else if(m.method==='tools/call'){appendFileSync(LOG,JSON.stringify({kind:'http-call',tool:m.params?.name,authOk})+'\n');result={content:[{type:'text',text:'HTTP_ECHO ok'}]};}
 r.writeHead(200,{'content-type':'application/json','mcp-session-id':'s1'});r.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});});
s.listen(0,'127.0.0.1',()=>console.log(s.address().port));
