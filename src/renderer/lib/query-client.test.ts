import {afterEach,expect,it,vi} from 'vitest';
import {onlineManager,type QueryClient} from '@tanstack/react-query';
import {createRendererQueryClient} from './query-client';
let client:QueryClient|undefined;
afterEach(()=>{client?.clear();onlineManager.setOnline(true);});
it('SM offline application IPC reads still execute rather than waiting for browser connectivity',async()=>{
 onlineManager.setOnline(false);client=createRendererQueryClient();const read=vi.fn(async()=>({drafts:['own-local-draft']})),pending=client.fetchQuery({queryKey:['applications','drafts','own-project'],queryFn:read}).then(value=>({value,error:null}),error=>({value:null,error}));
 try{await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce(),{timeout:200});expect((await pending).value).toEqual({drafts:['own-local-draft']});}finally{await client.cancelQueries();await pending;}
});
it('SM offline application provider failure returns its original reason without adding a query retry layer',async()=>{
 onlineManager.setOnline(false);client=createRendererQueryClient();const failure=new Error('own-provider-offline'),read=vi.fn(async()=>{throw failure;}),pending=client.fetchQuery({queryKey:['applications','zentao-work','own-project'],queryFn:read}).then(value=>({value,error:null}),error=>({value:null,error}));
 try{await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce(),{timeout:200});expect((await pending).error).toBe(failure);expect(read).toHaveBeenCalledTimes(1);}finally{await client.cancelQueries();await pending;}
});
it('SM application connectivity policy does not change other query namespaces',async()=>{
 onlineManager.setOnline(false);client=createRendererQueryClient();const read=vi.fn(async()=>1),pending=client.fetchQuery({queryKey:['other-scope'],queryFn:read}).catch(error=>error);expect(client.getQueryState(['other-scope'])?.fetchStatus).toBe('paused');expect(read).not.toHaveBeenCalled();await client.cancelQueries();await pending;
});
