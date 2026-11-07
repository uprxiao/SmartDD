import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {csvAcceptanceFixtures} from './csv-acceptance-fixtures.mjs';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-csv-acceptance-ui-'),projectPath=join(scratch,'project'),oracle=csvAcceptanceFixtures();await mkdir(projectPath);
for(const item of oracle.cases)await writeFile(join(projectPath,item.name),item.source);await writeFile(join(scratch,'fixtures.json'),JSON.stringify(oracle,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),fingerprints=async()=>Object.fromEntries(await Promise.all(oracle.cases.map(async({name})=>{const p=join(projectPath,name),s=await stat(p,{bigint:true});return[name,{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={caseId:'M9-T-F17',at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),scratch,projectPath,before:await fingerprints(),checks:[],status:'running'};let app,stage='initial';
try{
  app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'CSV and TSV full parsing acceptance'});
  for(const item of oracle.cases){
    stage=item.name;await app.open(item.name);await app.waitFor("Boolean(document.querySelector('.cm-content'))&&Boolean(document.querySelector('[aria-label=\"查看表格\"]'))");const check={file:item.name,defaultSource:true};await app.click('[aria-label="查看表格"]');await app.waitFor("Boolean(document.querySelector('.fw-csv'))");
    if(item.invalid){await app.waitFor("document.querySelector('.fw-csv [role=alert]')?.textContent.includes('引号未闭合')");check.explicitError=await app.evaluate("document.querySelector('.fw-csv [role=alert]').textContent");}
    else if(!item.rows.length){await app.waitFor("document.querySelector('.fw-csv [role=status]')?.textContent==='空表格'");check.empty=true;}
    else{
      await app.waitFor("document.querySelectorAll('.fw-csv [role=gridcell]').length>0");assert.equal(await app.evaluate("document.querySelector('.fw-csv [role=grid]').getAttribute('aria-readonly')"),'true');assert.equal(await app.evaluate("document.querySelector('.fw-csv [role=grid]').getAttribute('aria-rowcount')"),String(item.rows.length+1));
      const doc=(await app.cdp('DOM.getDocument')).root;await app.cdp('DOM.focus',{nodeId:(await app.cdp('DOM.querySelector',{nodeId:doc.nodeId,selector:'.fw-csv [role=grid]'})).nodeId});const selected=[];
      for(let row=0;row<item.rows.length;row++){
        await app.key('Home','Home');
        for(let column=0;column<5;column++){
          stage=`${item.name}:cell:${row}:${column}`;if(column)await app.key('ArrowRight','ArrowRight');const value=item.rows[row][column]??'',singleLine=value.replace(/[\r\n]/g,'');
          await app.waitFor(`document.querySelector('[aria-label="单元格内容"]')?.value===${JSON.stringify(singleLine)}&&document.querySelector('.fw-csv-value>span')?.textContent===${JSON.stringify(String.fromCharCode(65+column)+(row+1))}&&document.getElementById(document.querySelector('.fw-csv [role=grid]')?.getAttribute('aria-activedescendant'))?.textContent===${JSON.stringify(value)}`);selected.push(value);
        }
        if(row+1<item.rows.length)await app.key('ArrowDown','ArrowDown');
      }
      assert.equal(await app.evaluate("document.querySelector('[aria-label=\"单元格内容\"]').readOnly"),true);assert.equal(await app.evaluate("document.querySelectorAll('.fw-csv iframe,.fw-csv script').length"),0);check.selectedValues=selected;check.nativeKeyboardTraversed=20;check.multilineGridCellTextExact=true;check.valueBar='Existing single-line readonly input displays value without CR/LF; full cell DOM text and native parser retain them.';check.formulasStayedText=selected.includes('=SUM(A1:A2)');check.leadingZeroIdPreserved=selected.includes('0012345678901234567');
    }
    await app.screenshot(join(scratch,item.name+'.png'));await app.click('[aria-label="查看源码"]');await app.waitFor("Boolean(document.querySelector('.cm-content'))");
    // Visible source is compared separately from original byte identity.
    // Exact separators/EOL/BOM are checked in I and on disk.
    stage=item.name+':source';const source=item.source.replace(/^\uFEFF/,'').replace(/\r\n|\r/g,'\n');result.lastSourceView=await app.evaluate("[...document.querySelectorAll('.cm-content .cm-line')].map(e=>e.textContent).join('\\n')");
    await app.waitFor(`[...document.querySelectorAll('.cm-content .cm-line')].map(e=>e.textContent).join('\\n').replace(/\\s/g,'')===${JSON.stringify(source.replace(/\s/g,''))}`);check.sourceViewNonWhitespaceExact=true;check.sourceBytesAndIdentityExact=true;assert.deepEqual(await fingerprints(),result.before);await app.click('[aria-label="查看表格"]');await app.waitFor("Boolean(document.querySelector('.fw-csv'))");result.checks.push(check);
  }
  result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';result.boundary='No clipboard Copy action or source edit/save was invoked; readonly preview and source round trip, not CSV write-back claim.';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');result.failureCell=await app.evaluate("({bar:document.querySelector('[aria-label=\"单元格内容\"]')?.value,coordinate:document.querySelector('.fw-csv-value>span')?.textContent,cell:document.getElementById(document.querySelector('.fw-csv [role=grid]')?.getAttribute('aria-activedescendant'))?.textContent})");await app.screenshot(join(scratch,'failure.png'));}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}
