import {createContext,runInContext} from 'node:vm';
import {afterEach,expect,it,vi} from 'vitest';

async function fixture(options:{value?:unknown;deferred?:boolean;node?:boolean}={}){
  const calls:{message:string;initial:string}[]=[],page:Record<string,unknown>={},world:Record<string,unknown>={};
  world.window={prompt:(message:string,initial:string)=>{calls.push({message,initial});return options.value??null;}};
  if(options.node)world.process={};
  const isolated=createContext(world),main=createContext({window:page});
  const setWorld=vi.fn();
  vi.resetModules();
  vi.doMock('electron',()=>({
    contextBridge:{
      exposeInMainWorld:(name:string,value:unknown)=>{page[name]=value;},
      // Electron transfers the function, not its lexical closure.
      executeInMainWorld:({func}:{func:()=>unknown})=>runInContext('('+func.toString()+')()',main),
    },
    webFrame:{
      setIsolatedWorldInfo:setWorld,
      executeJavaScriptInIsolatedWorld:(_id:number,scripts:{code:string}[],_gesture:boolean,callback:(value:unknown,error?:Error)=>void)=>{
        try{
          const value=runInContext(scripts[0].code,isolated);
          if(!options.deferred)callback(value);
          return Promise.resolve(value);
        }catch(error){callback(undefined,error as Error);return Promise.reject(error);}
      },
    },
  }));
  await import('./browser-prompt');
  return{page,world,calls,setWorld,prompt:page.prompt as (message?:unknown,initial?:unknown)=>string|null};
}
afterEach(()=>{vi.doUnmock('electron');vi.resetModules();});

it.each(['accepted-中文','',null])('returns native prompt value %j synchronously',async value=>{
  const f=await fixture({value});
  expect(f.prompt('Question','初始')).toBe(value);
  expect(f.calls).toEqual([{message:'Question',initial:'初始'}]);
  expect(f.setWorld.mock.calls[0][0]).toBeGreaterThan(0);
});

it('keeps prompt default arguments and main-world string conversion',async()=>{
  const f=await fixture();f.prompt();f.prompt(null,123);
  expect(f.calls).toEqual([{message:'',initial:''},{message:'null',initial:'123'}]);
});

it('serializes page text as data rather than executable isolated-world code',async()=>{
  const f=await fixture({value:'ok'}),payload='\");globalThis.compromised=true;//\n中文\\text';
  expect(f.prompt(payload,payload)).toBe('ok');
  expect(f.calls).toEqual([{message:payload,initial:payload}]);
  expect(f.world.compromised).toBeUndefined();
});

it('rejects direct bridge calls with non-string data',async()=>{
  const f=await fixture(),bridge=f.page.__willyouNativePrompt as (a:unknown,b:unknown)=>unknown;
  expect(()=>bridge({script:'x'},'')).toThrow('Prompt arguments must be strings');
  expect(f.calls).toEqual([]);
});

it('fails honestly if a suspended frame cannot complete the synchronous callback',async()=>{
  const f=await fixture({value:'later',deferred:true});
  expect(()=>f.prompt('Question')).toThrow('did not settle synchronously');
});

it('refuses to run the native prompt when the isolated world contains Node',async()=>{
  const f=await fixture({node:true});
  expect(()=>f.prompt('Question')).toThrow('Unexpected Node in prompt world');
  expect(f.calls).toEqual([]);
});

it('rejects a native result outside the prompt string-or-null contract',async()=>{
  const f=await fixture({value:123});
  expect(()=>f.prompt('Question')).toThrow('Invalid native prompt result');
});
