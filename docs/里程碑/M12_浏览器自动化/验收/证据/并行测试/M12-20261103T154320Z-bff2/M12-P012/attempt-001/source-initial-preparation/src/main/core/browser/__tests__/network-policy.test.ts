import {EventEmitter} from 'node:events';
import {describe,expect,it,vi} from 'vitest';
import type {Session,WebContents} from 'electron';
import {BrowserNetworkPolicy} from '../network-policy';
function fixture(){
  const grants=new Set<string>(),failed=vi.fn();let gate:((details:any,callback:(result:{cancel:boolean})=>void)=>void)|null=null;
  const session={webRequest:{onBeforeRequest:(listener:typeof gate)=>{gate=listener;}}} as unknown as Session;
  const wc=Object.assign(new EventEmitter(),{id:1,session,isDestroyed:()=>false}) as unknown as WebContents;
  const policy=new BrowserNetworkPolicy({trusted:(profile,host)=>grants.has(profile+':'+host),failed});policy.install(wc,'p1');
  const certificate=(url='https://outside.example.test:8443/',main=true)=>{const callback=vi.fn(),event={preventDefault:vi.fn()};wc.emit('certificate-error',event,url,'ERR_CERT_AUTHORITY_INVALID',{},callback,main);expect(event.preventDefault).toHaveBeenCalledOnce();return callback;};
  const request=(url='https://outside.example.test:8443/next',type='mainFrame',id=1)=>{const callback=vi.fn();gate!({url,resourceType:type,webContentsId:id},callback);return callback.mock.calls[0][0].cancel;};
  return{grants,failed,policy,wc,session,certificate,request,gate:()=>gate};
}
describe('profile network policy',()=>{
  it('denies initial certificate failures; explicit profile trust permits any host',()=>{const f=fixture();expect(f.certificate()).toHaveBeenCalledWith(false);expect(f.failed).toHaveBeenCalledOnce();f.grants.add('p1:outside.example.test');expect(f.certificate()).toHaveBeenCalledWith(true);expect(f.request()).toBe(false);});
  it('blocks cached trust after revocation, including worker requests without contents',()=>{const f=fixture();f.grants.add('p1:outside.example.test');f.certificate();f.grants.clear();expect(f.request()).toBe(true);expect(f.request('https://outside.example.test:8443/sw','serviceWorker',-1)).toBe(true);expect(f.request('https://other.example.test/')).toBe(false);expect(f.request('http://outside.example.test:8443/')).toBe(false);expect(f.failed).toHaveBeenCalledWith(f.wc,{url:'https://outside.example.test:8443/next',host:'outside.example.test',error:'ERR_CERT_AUTHORITY_INVALID'});});
  it('composes nested profile suspension with the certificate gate without reinstalling a listener',()=>{const f=fixture(),original=f.gate(),release=f.policy.suspend('p1'),second=f.policy.suspend('p1');f.grants.add('p1:outside.example.test');expect(f.certificate()).toHaveBeenCalledWith(false);expect(f.request('http://any.example.test/')).toBe(true);release();release();expect(f.request()).toBe(true);second();expect(f.gate()).toBe(original);expect(f.request()).toBe(false);f.certificate();f.grants.clear();expect(f.request()).toBe(true);});
  it('fails closed if saved decisions cannot be read',()=>{const f=fixture();f.policy.dispose();const policy=new BrowserNetworkPolicy({trusted:()=>{throw Error('corrupt database');}});policy.install(f.wc,'p1');expect(f.certificate()).toHaveBeenCalledWith(false);policy.dispose();expect(f.gate()).toBe(null);expect(f.wc.listenerCount('certificate-error')).toBe(0);});
  it('rejects mixing profile identities in one native session and clears only owned hooks',()=>{const f=fixture(),other=Object.assign(new EventEmitter(),{id:2,session:f.session,isDestroyed:()=>false}) as unknown as WebContents;expect(()=>f.policy.install(other,'p2')).toThrow('cannot share');f.policy.dispose();expect(f.gate()).toBe(null);expect(f.wc.listenerCount('certificate-error')).toBe(0);});
});
