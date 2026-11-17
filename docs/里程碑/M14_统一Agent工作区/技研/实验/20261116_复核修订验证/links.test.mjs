import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,realpathSync,statSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
const t3=process.argv[2];if(!t3)throw Error('Pass the T3 fe59fa44d0 checkout root');
const root=import.meta.dirname,work=mkdtempSync(join(tmpdir(),'m14-links-')),project=join(work,'project'),outside=join(work,'outside');
const results=[];
try{
 mkdirSync(join(project,'src/main'),{recursive:true});mkdirSync(outside);writeFileSync(join(project,'src/main/index.ts'),'x\n'.repeat(50));writeFileSync(join(project,'notes.txt'),'original');writeFileSync(join(project,'sample.pdf'),'%PDF');writeFileSync(join(outside,'secret.txt'),'outside synthetic');symlinkSync(outside,join(project,'escape'));
 const esbuild=createRequire(import.meta.url)(process.argv[3] ?? 'esbuild');
 const entry=join(work,'entry.ts'),bundle=join(work,'links.mjs');
 writeFileSync(entry,`export * from ${JSON.stringify(resolve(t3,'packages/shared/src/markdownLinks.ts'))};\nexport * from ${JSON.stringify(resolve(t3,'packages/shared/src/fileLinks.ts'))};`);
 await esbuild.build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'error',alias:{'@t3tools/shared':resolve(t3,'packages/shared/src')}});
 const L=await import(pathToFileURL(bundle));
 function route(href,{projectId='p',modifier=false}={}){
  if(/^https?:\/\//i.test(href))return {target:projectId?'browser.newTab+navigate':'reject',reason:projectId?null:'project-required'};
  if(/^[a-z][\w+.-]*:/i.test(href)&&!/^file:/i.test(href))return {target:'reject',reason:'scheme-not-allowed'};
  if(href.includes('\0'))return {target:'reject',reason:'invalid-path'};
  let input=href;
  if(/^file:/i.test(href))input=L.parseFileUrlHref(href)?.path;
  if(!input)return {target:'plain-text'};
  const abs=L.resolveMarkdownFileLinkTarget(input,project);
  if(!abs)return {target:'plain-text'};
  const {path,line,column}=L.splitFilePathPosition(abs);
  const rel=relative(project,path);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))return {target:'reject',reason:'outside-root'};
  if(!existsSync(path))return {target:'reject',reason:'not-found'};
  const physical=relative(realpathSync(project),realpathSync(path));
  if(isAbsolute(physical)||physical==='..'||physical.startsWith('../'))return {target:'reject',reason:'symlink-outside-root'};
  return {target:modifier?'external-open':statSync(path).isDirectory()?'files.revealDirectory':'files.open',rel:rel||'.',line,column};
 }
 function scan(text,opts){
  const found=[];
  for(const href of L.extractMarkdownLinkHrefs(text))found.push(route(href,opts));
  for(const span of L.extractInlineCodeSpans(text)){
   const c=L.inlineCodeFilePathCandidate(span);found.push(c?route(c,opts):{target:'plain-text'});
  }
  for(const m of L.absoluteFilePathMatches(text))found.push(route(m.path,opts));
  for(const m of text.matchAll(/(?<!\()https?:\/\/[^\s)\]]+/g))found.push(route(m[0],opts));
  return found;
 }
 function check(id,fn){try{const detail=fn();results.push({id,status:'passed',detail});}catch(e){results.push({id,status:'failed',error:e.message});}}
 const cases=[
 ['codex-real','Created `notes.txt` containing the single line `hello m14`.','plain-text'],
 ['claude-real',`I created \`${project}/notes.txt\` containing the single line.`,'files.open'],
 ['directory',`当前目录是：[SmartDD](${project})`,'files.revealDirectory'],
 ['md-line','修改见 [index.ts](src/main/index.ts:42)','files.open'],
 ['inline-column','错误在 `src/main/index.ts:42:7`','files.open'],
 ['absolute',`日志写在 ${project}/src/main/index.ts 里`,'files.open'],
 ['file-url',`[打开](file://${project}/notes.txt)`,'files.open'],
 ['outside',`参考 \`${outside}/secret.txt\` 文件`,'reject'],
 ['missing','见 `src/main/missing.ts:3`','reject'],
 ['url','文档：[T3](https://t3.codes/docs) 以及 https://example.com/a?b=1','browser.newTab+navigate'],
 ['dangerous','[x](javascript:alert(1)) [y](mailto:a@b.c)','reject'],
 ['route-not-file','接口 `/api/users.json` 返回 404','reject'],
 ];
 for(const [id,text,target] of cases)check(id,()=>{const got=scan(text);assert(got.some(x=>x.target===target),JSON.stringify(got));return got;});
 check('line and column retained',()=>assert.deepEqual(route('src/main/index.ts:42:7'),{target:'files.open',rel:'src/main/index.ts',line:42,column:7}));
 check('symlink escape denied',()=>assert.equal(route('escape/secret.txt:1').reason,'symlink-outside-root'));
 check('no project cannot open browser',()=>assert.equal(route('https://example.com',{projectId:null}).reason,'project-required'));
 check('modifier uses same root checks',()=>{assert.equal(route('src/main/index.ts:1',{modifier:true}).target,'external-open');assert.equal(route(outside+'/secret.txt',{modifier:true}).target,'reject');});
 check('PDF keeps existing file viewer',()=>assert.equal(route('sample.pdf').target,'files.open'));
 // Replay actual model text. Original absolute paths are remapped to this synthetic root.
 const original=JSON.parse(readFileSync(join(root,'fixtures/v03-a-result.json'),'utf8'));
 for(const driver of ['codex','claude'])check('recorded-output:'+driver,()=>{
  const text=original[driver].text.replaceAll(/<review-scratch>\/runs\/v03-a\/claude-project/g,project);
  const got=scan(text);assert(got.length>0);assert(got.some(x=>['plain-text','files.open','files.revealDirectory'].includes(x.target)));return {text,links:got};
 });
}finally{rmSync(work,{recursive:true,force:true});}
mkdirSync(join(root,'results'),{recursive:true});
const result={scope:'T3 actual parser + isolated router; recorded output replay; no file workspace UI',results,failed:results.filter(x=>x.status==='failed').length};
writeFileSync(join(root,'results/links.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));process.exitCode=result.failed?1:0;
