export default {root:new URL('.',import.meta.url).pathname,cacheDir:new URL('./cache/vitest/',import.meta.url).pathname,test:{include:['skill.test.mjs'],environment:'node',maxWorkers:1}};
