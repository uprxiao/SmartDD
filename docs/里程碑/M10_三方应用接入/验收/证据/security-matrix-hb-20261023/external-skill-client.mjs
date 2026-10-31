// Unmanaged process: reads a real projection but receives no bootstrap or credential.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {connect} from 'node:net';
const input=JSON.parse(readFileSync(0,'utf8'));
assert.match(input.endpoint,/^\/private\/tmp\/wy-\d+-[^/]+\/broker\.sock$|^\/tmp\/wy-\d+-[^/]+\/broker\.sock$/);
const bytes=readFileSync(input.skillPath),hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,input.skillSha256);
const call={operation:'smartdd_mail_draft_list_v1',contractMajor:1,connectionId:null,arguments:{limit:10}};
const attempts=[{name:'no credential',request:{method:'tools/call',call}},{name:'invented token',request:{method:'tools/call',token:'f'.repeat(64),call}},{name:'foreign project and package',request:{method:'tools/call',token:'f'.repeat(64),projectId:input.otherProjectId,packageHash:'0'.repeat(64),call:{...call,connectionId:randomUUID()}}}];
const responses=[];
for(const attempt of attempts){const response=await new Promise((resolve,reject)=>{const socket=connect(input.endpoint);let buffer='',done=false;const timer=setTimeout(()=>finish(new Error('external protocol deadline')),5000);function finish(error,value){if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);}socket.once('error',e=>finish(e));socket.once('connect',()=>socket.write(JSON.stringify({schema:1,id:randomUUID(),...attempt.request})+'\n'));socket.on('data',chunk=>{buffer+=chunk;const i=buffer.indexOf('\n');if(i>=0)try{finish(null,JSON.parse(buffer.slice(0,i)));}catch(e){finish(e);}});socket.once('close',()=>{if(!done)finish(new Error('external socket closed before response'));});});assert.equal(response.status,'error');assert(['AUTH_REQUIRED','INVALID_INPUT'].includes(response.error.code));responses.push({name:attempt.name,response});}
assert.equal(responses[1].response.error.code,'AUTH_REQUIRED');
process.stdout.write(JSON.stringify({pid:process.pid,cwd:process.cwd(),skillPath:input.skillPath,skillSha256:hash,skillBytes:bytes.length,receivedCredential:false,responses})+'\n');
