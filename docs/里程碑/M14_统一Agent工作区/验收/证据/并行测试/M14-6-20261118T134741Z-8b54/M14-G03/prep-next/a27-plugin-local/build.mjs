import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

const appId='a27-local-effect';
export const capability=appId+'.record.write';
export const marker='A27_LOCAL_DURABLE_NO_REPLY';
export const manifest={schema:'willyou-plugin/v0-draft2',id:appId,version:'0.1.0',hostApi:1,
  displayName:'A27 私有写入夹具',description:'本地合成数据，允许一次私有文件写入，故意不回执。',
  permissions:[],providers:[],skills:[],
  capabilities:{[capability]:{title:'写入 A27 私有合成效果',semantics:'write',permission:appId+'.write',retry:'never',maxTier:'ask',
    slots:[],input:'schemas/in.json',output:'schemas/out.json'}},
  runtime:{type:'process',entry:'runtime/main.mjs',protocol:'jsonrpc-stdio/1'},ui:{panels:[]},
};
export function buildPlugin(root) {
  assert(root.startsWith('/private/tmp/willyou-m14-stage6.WRvdST/g03/')&&!root.includes('/../'));
  mkdirSync(root);
  const put=(relative,value)=>{
    const dst=join(root,relative);
    mkdirSync(dirname(dst),{recursive:true});
    writeFileSync(dst,JSON.stringify(value,null,2)+'\n');
  };
  put('.willyou-plugin/plugin.json',manifest);
  put('schemas/in.json',{type:'object',additionalProperties:false,required:['marker'],properties:{marker:{const:marker}}});
  put('schemas/out.json',{type:'object',additionalProperties:false,required:['recorded'],properties:{recorded:{type:'boolean'}}});
  mkdirSync(join(root,'runtime'));
  copyFileSync(new URL('./runtime.mjs',import.meta.url),join(root,'runtime/main.mjs'));
  return root;
}
