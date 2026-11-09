import {EventEmitter} from 'node:events';import{BrowserCdpProxy}from'/Users/liubu/hx/4.uprxiao/SmartDD/src/main/core/browser/cdp-proxy';
class D extends EventEmitter{isAttached(){return false}attach(){}detach(){}async sendCommand(){return{}}}
const p=new BrowserCdpProxy({debugger:new D(),isDestroyed:()=>false,getTitle:()=>'node',getURL:()=>''} as any,x=>console.log('TRACE',JSON.stringify(x)));
async function main(){const url=await p.start();console.log('START');const w=new WebSocket(url);w.onopen=()=>{console.log('OPEN');w.send(JSON.stringify({id:1,method:'Browser.getVersion'}))};w.onmessage=async m=>{console.log('REPLY',m.data);w.close();await p.stop()};setTimeout(async()=>{console.log('DEADLINE');w.close();await p.stop()},3000).unref();}
void main();