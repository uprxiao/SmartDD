import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import vm from'node:vm';import{createHash}from'node:crypto';import{createRequire}from'node:module';
export const SOURCE_SHA256='35bbe5cd9c48e729fe36f1a8dfe9668e8905e13f4654631018ed4324c281b978';
const sourcePath=new URL('./source-inputs/browser-downloads.ts',import.meta.url);let cached;
// Execute only this hash-bound trusted local production pure function, never
// model-provided JavaScript or product/Native runtime. No imports in the source.
export function loadFilenameOracle(){
  const source=fs.readFileSync(sourcePath,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');assert.equal(sha(source),SOURCE_SHA256);
  if(cached)return cached;
  const ts=createRequire(import.meta.url)('typescript'),ast=ts.createSourceFile('browser-downloads.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0);assert(ast.statements.every(n=>ts.isInterfaceDeclaration(n)||ts.isFunctionDeclaration(n)),'Only frozen pure declarations allowed');
  const emitted=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,newLine:ts.NewLineKind.LineFeed}});assert.equal(emitted.diagnostics?.length??0,0);
  const exports={},context={exports,module:{exports}};new vm.Script(emitted.outputText,{filename:'frozen-browser-downloads.js'}).runInNewContext(context,{timeout:1000});assert.equal(typeof exports.browserDownloadFilename,'function');
  cached=Object.freeze({filename:exports.browserDownloadFilename,sourceSHA256:SOURCE_SHA256,emittedSHA256:sha(emitted.outputText),pureDeclarationsOnly:true,transpileModule:true});return cached;
}
export function assertFilenameShape(name){assert.equal(typeof name,'string');assert(name.length>0);assert(!/[\p{Cc}<>:"|?*\\/]/u.test(name));assert(!/[. ]$/.test(name));assert.equal(path.basename(name),name);}
export function assertIllegalDownloadBinding({record,native,oracle,taskId,pageId,contentsId,downloadsPath,url,expectedBytes}){
  assert(record&&native);assert.equal(record.url,url);assert.equal(native.url,url);assert.equal(record.taskId,taskId);assert.equal(record.pageId,pageId);assert.equal(native.contentsId,contentsId);assert.equal(record.state,'done');assert.equal(record.destination,'downloads');assert.equal(native.done.state,'completed');
  const expected=oracle.filename(native.filename);assertFilenameShape(expected);assertFilenameShape(record.name);assert.equal(record.name,expected);assert.equal(record.path,path.join(downloadsPath,expected));assert.equal(native.synchronousSavePath,record.path);assert.equal(native.done.path,record.path);assert.equal(record.totalBytes,expectedBytes);assert.equal(record.receivedBytes,expectedBytes);assert.equal(native.done.received,expectedBytes);return expected;
}
export function filenameOracleControls(){
  const oracle=loadFilenameOracle();assert.equal(oracle.filename('目录/非法<>:"|?*.csv. '),'非法_______.csv');assert.equal(oracle.filename('非法_______.csv._'),'非法_______.csv._');assert.equal(oracle.filename('x\u0000.csv'),'x.csv');
  for(const bad of['bad?.csv','trail.','trail ','dir/file.csv'])assert.throws(()=>assertFilenameShape(bad));
  const args={record:{url:'http://fixture.invalid/illegal',taskId:'task',pageId:'page',state:'done',destination:'downloads',name:'非法_______.csv._',path:'/owned/非法_______.csv._',totalBytes:22,receivedBytes:22},native:{url:'http://fixture.invalid/illegal',contentsId:2,filename:'非法_______.csv._',synchronousSavePath:'/owned/非法_______.csv._',done:{state:'completed',path:'/owned/非法_______.csv._',received:22}},oracle,taskId:'task',pageId:'page',contentsId:2,downloadsPath:'/owned',url:'http://fixture.invalid/illegal',expectedBytes:22};
  assert.equal(assertIllegalDownloadBinding(args),'非法_______.csv._');
  for(const mutate of[x=>x.record.name='wrong.csv',x=>x.record.url='http://fixture.invalid/other',x=>x.native.contentsId=3,x=>x.record.path='/outside/wrong.csv',x=>x.native.done.received=21]){const x={...args,record:{...args.record},native:{...args.native,done:{...args.native.done}}};mutate(x);assert.throws(()=>assertIllegalDownloadBinding(x));}
  return{trustedSourceSHA256:oracle.sourceSHA256,emittedSHA256:oracle.emittedSHA256,positiveSanitizerControls:3,positiveExactBinding:1,negativeFilenameShapes:4,negativeBindings:5,modelOrNativeCodeExecuted:false};
}
