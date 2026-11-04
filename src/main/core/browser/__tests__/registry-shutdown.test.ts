import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserPageRegistry} from '../page-registry';

const f=vi.hoisted(()=>({contents:[] as {destroyed:boolean}[],nextId:0,inLoad:false,loadGate:undefined as Promise<void>|undefined,events:[] as string[],proxyStops:0}));
vi.mock('electron',async()=>{
  const {EventEmitter}=await import('node:events');
  class Contents extends EventEmitter{
    id=++f.nextId;destroyed=false;session={};
    readonly closed=new Promise<never>((_,reject)=>this.once('destroyed',()=>reject(new Error('Owned contents closed'))));
    constructor(){super();f.contents.push(this);void this.closed.catch(()=>{});}
    setWindowOpenHandler(){}getURL(){return'about:blank';}getTitle(){return'Fixture';}isDestroyed(){return this.destroyed;}
    async loadURL(){f.inLoad=true;await Promise.race([f.loadGate??Promise.resolve(),this.closed]);}
    close(){if(!this.destroyed){this.destroyed=true;f.events.push('contents-closed');this.emit('destroyed');}}
  }
  return{BaseWindow:class{},WebContentsView:class{webContents:Contents;constructor(options?:{webContents?:Contents}){this.webContents=options?.webContents??new Contents();}setBounds(){}}};
});
vi.mock('../park-window',()=>({BrowserParkWindow:class{async park(){f.events.push('park');}remove(){f.events.push('remove');}dispose(){f.events.push('park-disposed');}}}));
vi.mock('../cdp-proxy',()=>({BrowserCdpProxy:class{endpoint='ws://owned';async start(){return this.endpoint;}async stop(){f.proxyStops++;}}}));
vi.mock('../references',()=>({BrowserReferences:class{async initialize(){}invalidate(){}}}));
vi.mock('../agent-browser',()=>({BrowserHelper:class{async close(){}}}));
const registries:BrowserPageRegistry[]=[];
function registry(){const value=new BrowserPageRegistry({userData:'/private/tmp/m12-registry-software-no-native',helper:{executable:'/must-not-run',sha256:'0'.repeat(64)}});registries.push(value);return value;}
beforeEach(()=>{f.contents=[];f.nextId=0;f.inLoad=false;f.loadGate=undefined;f.events=[];f.proxyStops=0;});
afterEach(async()=>{for(const value of registries.splice(0))await value.dispose();});
it('never allocates a view after disposal, even if a late caller still holds the registry',async()=>{
  const value=registry();await value.dispose();await expect(value.create('task1','project1')).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(f.contents).toHaveLength(0);expect(value.all()).toEqual([]);
});
it('closes and drains a page initialization already in flight before finishing disposal',async()=>{
  let release!:()=>void;f.loadGate=new Promise<void>(resolve=>{release=resolve;});const value=registry(),created=value.create('task1','project1').catch(error=>error);
  try{await vi.waitFor(()=>expect(f.inLoad).toBe(true));await value.dispose();expect(f.contents).toHaveLength(1);expect(f.contents[0].destroyed).toBe(true);expect(await created).toBeInstanceOf(Error);expect(value.all()).toEqual([]);expect(f.events.indexOf('park-disposed')).toBeGreaterThan(f.events.indexOf('contents-closed'));}
  finally{release();await created;}
});
it('does not allocate an opener popup after the registry has been disposed',async()=>{
  const value=registry(),opener=await value.create('task1','project1');await value.dispose();const count=f.contents.length;let failure:unknown;
  try{value.createPopup(opener,{},true);}catch(error){failure=error;}
  try{expect(failure).toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(f.contents).toHaveLength(count);}
  finally{await vi.waitFor(()=>expect(f.contents.every(contents=>contents.destroyed)).toBe(true));}
});
