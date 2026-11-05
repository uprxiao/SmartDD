// Pure-data execution of the actual generated expression with a fake Electron/fs.
import{readFile,writeFile}from'node:fs/promises';
import{createRequire}from'node:module';
import{EventEmitter}from'node:events';
import vm from'node:vm';
const require=createRequire(import.meta.url),ts=require('/private/tmp/willyou-m12-p069-parked-resource-001/source018-preparation-004/node_modules/typescript');
const current=new URL('.',import.meta.url).pathname.replace(/\/$/,''),original='/private/tmp/willyou-m12-p069-launchservices-probe-009';
async function check(root,wrongEscape=false){
 const source=await readFile(root+'/run.mjs','utf8'),ast=ts.createSourceFile('run.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let declaration;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='lifecycleExpression')declaration=n;ts.forEachChild(n,visit);}visit(ast);
 const userData=current+'/runtime/userData',appAsar=current+'/app/WillYou.app/Contents/Resources/app.asar',life=current+'/test-only.jsonl';
 const make=vm.runInNewContext('('+declaration.getText(ast)+')',{JSON,appEvent:{pid:1234},userData,appAsar,lifecycle:life,canonicalExpected:{userData,appPathAsar:appAsar}});let expression=make();if(wrongEscape)expression=expression.replaceAll('\\n','\\\\n');
 const app=new EventEmitter();app.getPath=()=>userData;app.getAppPath=()=>appAsar;
 const fake=new EventEmitter(),chunks=[];fake.pid=1234;fake.cwd=()=>'/';fake.getBuiltinModule=name=>name==='module'?{createRequire:()=>()=>({app})}:{appendFileSync:(p,text)=>{if(p!==life)throw Error('unexpected path');chunks.push(text);},realpathSync:p=>p};
 vm.runInNewContext(expression,{process:fake,JSON,Date});app.emit('before-quit');app.emit('will-quit');app.emit('quit',{},0);fake.emit('exit',0);
 const bytes=chunks.join('');let records=[],error=null;try{records=bytes.trim().split('\n').map(JSON.parse);}catch(e){error=String(e);}
 return {sourceRoot:root,generatedExpression:expression,actualBytes:bytes,literalBackslashNCount:(bytes.match(/\\n/g)??[]).length,lineFeedCount:(bytes.match(/\n/g)??[]).length,records,error,passed:!error&&records.length===4&&records.map(x=>x.kind).join(',')==='before-quit,will-quit,quit,process-exit-event'};
}
const old=await check(original),fixed=await check(current),negative=await check(current,true);
await writeFile(current+'/009-jsonl-original-check.json',JSON.stringify(old,null,2)+'\n');
await writeFile(current+'/jsonl-roundtrip-check.json',JSON.stringify(fixed,null,2)+'\n');
await writeFile(current+'/jsonl-negative-control.json',JSON.stringify(negative,null,2)+'\n');if(!old.passed||!fixed.passed||negative.passed)throw Error('Actual old/new JSONL must pass; deliberately overescaped expression must fail');
console.log(JSON.stringify({originalPassed:old.passed,originalLiteralSlashN:old.literalBackslashNCount,fixedPassed:fixed.passed,fixedLineFeeds:fixed.lineFeedCount,negativePassed:negative.passed,NativeExecuted:false}));
