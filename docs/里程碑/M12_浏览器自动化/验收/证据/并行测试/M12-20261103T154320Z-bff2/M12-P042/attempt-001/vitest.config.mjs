export default {root: new URL('.',import.meta.url).pathname,cacheDir:new URL('./cache/',import.meta.url).pathname,test:{include:['manifest.test.ts'],environment:'node',maxWorkers:1}};
