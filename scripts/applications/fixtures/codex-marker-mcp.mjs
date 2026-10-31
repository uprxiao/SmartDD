// Read-only synthetic MCP used by the isolated Codex adapter probe.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
const bytes=readFileSync(process.argv[2]),manifest=JSON.parse(bytes);
const packageHash=createHash('sha256').update(bytes).digest('hex');
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);if(request.id===undefined)return;
 const send=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
 if(request.method==='initialize')return send({protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'m10-fixed-marker',version:'1.0.0'}});
 if(request.method==='tools/list')return send({tools:[{name:'fixed_marker',description:'Return the immutable synthetic package hash and version; no business data or writes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}]});
 if(request.method==='tools/call'&&request.params.name==='fixed_marker')return send({content:[{type:'text',text:JSON.stringify({version:manifest.version,packageHash,skillSha256:manifest.skillSha256,marker:manifest.marker})}]});
 if(request.method==='ping')return send({});
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unsupported synthetic fixture request'}})+'\n');
});
