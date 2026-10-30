import {QueryClient} from '@tanstack/react-query';

export function createRendererQueryClient(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
 // Application queries read through local IPC. The host owns provider network budgets.
 client.setQueryDefaults(['applications'],{networkMode:'always'});
 return client;
}
