import {defineConfig} from 'vitest/config';
const root='/private/tmp/willyou-m12-t005-url-u-002';
export default defineConfig({root,cacheDir:root+'/cache/vite',server:{hmr:false,middlewareMode:true},test:{include:['contract.test.ts'],environment:'node',maxWorkers:1,fileParallelism:false,pool:'threads',watch:false,api:false,cache:{dir:root+'/cache/vitest'},testTimeout:5000,hookTimeout:5000}});
