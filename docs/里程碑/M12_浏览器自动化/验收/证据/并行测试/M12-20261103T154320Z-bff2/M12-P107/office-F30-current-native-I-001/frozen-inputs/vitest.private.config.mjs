import {resolve} from 'node:path';
import {defineConfig} from 'vitest/config';
const root='/private/tmp/willyou-m12-t130-F30-native-prep-001';
export default defineConfig({root:root+'/inputs',cacheDir:root+'/cache/vitest',resolve:{alias:{'@main':resolve(root,'inputs/src/main'),'@shared':resolve(root,'inputs/src/shared'),'@renderer':resolve(root,'inputs/src/renderer'),'@root':resolve(root,'inputs'),'@parcel/watcher':resolve(root,'current-watcher/index.js')}},test:{include:['src/renderer/features/files/office-handoff-acceptance.test.ts'],environment:'node',maxWorkers:1,fileParallelism:false,pool:'forks',reporters:['json'],outputFile:{json:root+'/output/vitest.json'}}});
