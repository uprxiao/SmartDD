import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({root:path.resolve(import.meta.dirname,'../..'),plugins:[react()],cacheDir:'/private/tmp/m9-predev-editor/vite-cache',server:{host:'127.0.0.1',port:4193,strictPort:true,fs:{allow:[path.resolve(import.meta.dirname,'../..'),'/private/tmp/m9-predev-editor']}}});
