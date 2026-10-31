// Acceptance-only passive observation in the explicitly inspected private App.
// No response bytes, authentication, policy, timing or identity are replaced.
import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {randomUUID} from 'node:crypto';
export async function installBrokerObserver(app){
 return app.mainEvaluate(`(()=>{if(globalThis.__m10BrokerObserver)throw Error('observer already installed');const net=process.getBuiltinModule('net'),original=net.Socket.prototype.write,state={original,tokens:[]};state.wrapper=function(...args){try{const endpoint=this.server?.address();if(typeof endpoint==='string'&&/^\\/(?:private\\/)?tmp\\/wy-\\d+-[^/]+\\/broker\\.sock$/.test(endpoint)){const text=Buffer.isBuffer(args[0])?args[0].toString('utf8'):args[0];if(typeof text==='string'&&text.length<4096){const v=JSON.parse(text);if(v.status==='ok'&&typeof v.value?.token==='string'&&/^[a-f0-9]{64}$/.test(v.value.token))state.tokens.push({token:v.value.token,endpoint,at:Date.now()});}}}catch{}return original.apply(this,args);};net.Socket.prototype.write=state.wrapper;globalThis.__m10BrokerObserver=state;return true;})()`);
}
export async function collectAndRestoreBrokerObserver(app){
 return app.mainEvaluate(`(()=>{const s=globalThis.__m10BrokerObserver;if(!s)return null;const net=process.getBuiltinModule('net');if(net.Socket.prototype.write!==s.wrapper)throw Error('observer ownership changed');net.Socket.prototype.write=s.original;delete globalThis.__m10BrokerObserver;return{tokens:s.tokens,restored:true};})()`);
}
export async function replayOldCredential(endpoint,token){
 assert(/^[a-f0-9]{64}$/.test(token));
 return new Promise((resolve,reject)=>{const socket=connect(endpoint);let buffer='',finished=false;const timer=setTimeout(()=>finish(new Error('old credential replay deadline')),5000);function finish(error,value){if(finished)return;finished=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);}socket.once('error',e=>finish(e));socket.once('connect',()=>socket.write(JSON.stringify({schema:1,id:randomUUID(),method:'tools/list',token})+'\n'));socket.on('data',bytes=>{buffer+=bytes;const i=buffer.indexOf('\n');if(i>=0)try{finish(null,JSON.parse(buffer.slice(0,i)));}catch(e){finish(e);}});socket.once('close',()=>{if(!finished)finish(new Error('old credential socket closed without response'));});});
}
