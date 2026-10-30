import test from 'node:test';
import assert from 'node:assert/strict';
import { officeCapabilities, createOfficeHistory, createOfficeDocument, editOffice, serializeOffice, officeDirty, markOfficeSaved, cellAddress, parseAddress, selectionRange, rangeCells, cellValue, displayCell, presentationShortcut } from '../src/file-office-model.mjs';
const live = officeCapabilities('xlsx', { sourceState:'live', manualEditUiEnabled:true });
const ppt = officeCapabilities('pptx', { manualEditing:true });
const state = () => createOfficeHistory('xlsx');
const apply = (s, action, caps=live) => editOffice(s,{sheetId:s.doc.sheets[0].id,...action},caps);
const cell = (s,row,col,value) => apply(s,{type:'cell',row,col,value});

test('host readOnly is a hard guard for every source and DOCX stays readonly',()=>{
  for(const kind of ['xlsx','xlsm','pptx','docx']) for(const sourceState of ['live','starting','refreshing','fallback','blocked']) assert.equal(officeCapabilities(kind,{readOnly:true,sourceState,manualEditing:true,manualEditUiEnabled:true}).editable,false);
  assert.equal(officeCapabilities('docx',{manualEditing:true,manualEditUiEnabled:true}).editable,false);
});
test('workbook live editing and manual format gates are independent',()=>{
  assert.equal(officeCapabilities('xlsx',{sourceState:'live'}).editable,true);
  assert.equal(officeCapabilities('xlsx',{sourceState:'live'}).format,false);
  for(const sourceState of ['starting','refreshing','fallback','blocked']) assert.equal(officeCapabilities('xlsx',{sourceState,manualEditUiEnabled:true}).editable,false);
  for(const patch of [{canWrite:false},{canRead:false},{sourceBytes:false},{libraryFile:true},{interactionsDisabled:true}]) assert.equal(officeCapabilities('xlsx',{...patch,sourceState:'live'}).editable,false);
});
test('PPT source and annotation gates and DOCX route controls',()=>{
  assert.equal(officeCapabilities('pptx',{}).editable,false);
  assert.equal(ppt.editable,true);
  for(const patch of [{canWrite:false},{sourceBytes:false},{libraryFile:true},{template:true}]) assert.equal(officeCapabilities('pptx',{manualEditing:true,...patch}).editable,false);
  assert.equal(officeCapabilities('pptx',{template:true,annotationsEnabled:true}).annotate,false);
  const legacy=officeCapabilities('docx',{docxRoute:'legacy',annotationsEnabled:true});assert.equal(legacy.annotate,true);assert.equal(legacy.pageRail,true);assert.equal(legacy.redlines,true);
  const pop=officeCapabilities('docx',{docxRoute:'popcorn',annotationsEnabled:true});assert.equal(pop.annotate,false);assert.equal(pop.pageRail,false);assert.equal(pop.search,false);assert.equal(pop.headerPager,false);
});
test('readonly legacy DOCX may hand off selected context without gaining edit or Popcorn controls',()=>{
  const input={readOnly:true,docxRoute:'legacy',annotationsEnabled:true,redlinesEnabled:false};
  const caps=officeCapabilities('docx',input);assert.equal(caps.editable,false);assert.equal(caps.annotate,true);assert.equal(caps.redlines,false);
  assert.equal(officeCapabilities('docx',{...input,annotationsEnabled:false}).annotate,false);
  assert.equal(officeCapabilities('docx',{...input,interactionsDisabled:true}).annotate,false);
  assert.equal(officeCapabilities('docx',{...input,docxRoute:'popcorn'}).annotate,false);
  assert.equal(officeCapabilities('pptx',{...input,manualEditing:true}).annotate,false);
});
test('legacy fixtures migrate preserving titles, sheets, wide rows and string zero',()=>{
  const doc=createOfficeDocument('pptx',JSON.stringify({slides:[{title:'旧标题'}],sheets:[{name:'旧表',cells:[['a'],['0','b','c','d','e','f','g','h']]}]}));
  assert.equal(doc.slides[0].elements[0].text,'旧标题');assert.equal(doc.sheets[0].name,'旧表');assert.equal(doc.sheets[0].cells[1][0],'0');assert.equal(doc.sheets[0].cells[1][7],'h');assert.equal(doc.sheets[0].cells[0].length,8);
});
test('serialization roundtrip preserves formats, notes, merges and identifiers',()=>{
  let s=state();s=apply(s,{type:'format',range:{r1:1,r2:2,c1:1,c2:2},patch:{bold:true,fill:'#aabbcc'}});s=apply(s,{type:'merge',range:{r1:7,r2:8,c1:1,c2:2}});
  const restored=createOfficeDocument('xlsx',serializeOffice(s.doc));assert.deepEqual(restored,s.doc);
});
test('address mapping, reverse selections and clipping do not escape sheet',()=>{
  assert.equal(cellAddress(11,26),'AA12');assert.deepEqual(parseAddress('aa12'),{row:11,col:26});assert.equal(parseAddress('A0'),null);
  const r=selectionRange({row:3,col:4},{row:1,col:2});assert.deepEqual(r,{r1:1,r2:3,c1:2,c2:4});assert.equal(rangeCells({r1:-5,r2:999,c1:-2,c2:999},state().doc.sheets[0]).length,72);
});
test('range formatting applies all selected cells and does not touch neighbors',()=>{
  const s=apply(state(),{type:'format',range:{r1:1,r2:2,c1:1,c2:2},patch:{bold:true,align:'right'}});
  for(const key of ['B2','C2','B3','C3']) assert.equal(s.doc.sheets[0].formats[key].bold,true);
  assert.equal(s.doc.sheets[0].formats.A1,undefined);assert.equal(officeDirty(s),true);
});
test('readOnly rejects edits and disabled manual UI rejects format and clear-format',()=>{
  const s=state(), read=officeCapabilities('xlsx',{readOnly:true});for(const action of [{type:'cell',row:0,col:0,value:'bad'},{type:'sheet-add'},{type:'undo'}]) assert.deepEqual(apply(s,action,read).doc,s.doc);
  const basic=officeCapabilities('xlsx');for(const action of [{type:'format',range:{r1:0,r2:0,c1:0,c2:0},patch:{bold:true}},{type:'clear',mode:'all',range:{r1:0,r2:0,c1:0,c2:0}}])assert.deepEqual(apply(s,action,basic).doc,s.doc);
});
test('undo redo restore complete model; branching discards redo',()=>{
  const base=state(), a=cell(base,1,2,'9'), b=apply(a,{type:'sheet-add'});let s=apply(b,{type:'undo'});assert.deepEqual(s.doc,a.doc);s=apply(s,{type:'undo'});assert.deepEqual(s.doc,base.doc);assert.equal(officeDirty(s),false);s=apply(s,{type:'redo'});assert.deepEqual(s.doc,a.doc);s=cell(s,1,2,'11');assert.equal(s.future.length,0);assert.equal(apply(s,{type:'redo'}),s);
});
test('save acknowledgement for older snapshot never marks newer model clean',()=>{
  let s=cell(state(),1,2,'9'), saved=serializeOffice(s.doc);s=cell(s,1,2,'10');s=markOfficeSaved(s,saved);assert.equal(officeDirty(s),true);assert.equal(officeDirty(markOfficeSaved(s)),false);
});
test('sheet names validate empty, reserved, overlength and case duplicate',()=>{
  const s=state();for(const name of ['','x/y','a'.repeat(32),'验收']) {const n=apply(s,{type:'sheet-rename',name});assert.ok(n.error);assert.deepEqual(n.doc,s.doc);}
  let n=apply(s,{type:'sheet-rename',name:'Data'});n=editOffice(n,{type:'sheet-rename',sheetId:n.doc.sheets[1].id,name:'data'},live);assert.ok(n.error);
});
test('sheet add move and delete retain identity and guard last sheet',()=>{
  let s=apply(state(),{type:'sheet-add'}), added=s.doc.sheets.at(-1).id;assert.equal(s.doc.sheets.length,3);s=editOffice(s,{type:'sheet-move',sheetId:added,index:0},live);assert.equal(s.doc.sheets[0].id,added);
  while(s.doc.sheets.length>1)s=editOffice(s,{type:'sheet-delete',sheetId:s.doc.sheets.at(-1).id},live);const one=s;s=apply(s,{type:'sheet-delete'});assert.deepEqual(s.doc,one.doc);assert.ok(s.error);
});
test('merge collision is rejected; unmerge retains underlying values',()=>{
  let s=state(), value=s.doc.sheets[0].cells[2][2];s=apply(s,{type:'merge',range:{r1:1,r2:2,c1:1,c2:2}});assert.equal(s.doc.sheets[0].merges.length,1);let failed=apply(s,{type:'merge',range:{r1:2,r2:3,c1:2,c2:3}});assert.ok(failed.error);assert.equal(failed.doc.sheets[0].merges.length,1);s=apply(s,{type:'unmerge',range:{r1:1,r2:1,c1:1,c2:1}});assert.equal(s.doc.sheets[0].merges.length,0);assert.equal(s.doc.sheets[0].cells[2][2],value);
});
test('fill/clear separates values and formats',()=>{
  let s=state(), r={r1:1,r2:3,c1:1,c2:1};s=apply(s,{type:'format',range:r,patch:{bold:true}});s=apply(s,{type:'fill',range:r,direction:'down'});assert.equal(s.doc.sheets[0].cells[3][1],s.doc.sheets[0].cells[1][1]);s=apply(s,{type:'clear',range:r,mode:'contents'});assert.equal(s.doc.sheets[0].cells[1][1],'');assert.equal(s.doc.sheets[0].formats.B2.bold,true);s=apply(s,{type:'clear-format',range:r});assert.equal(s.doc.sheets[0].formats.B2,undefined);
});
test('validation rejects invalid numbers and checkbox creates boolean fixtures',()=>{
  let s=apply(state(),{type:'validation',range:{r1:7,r2:7,c1:0,c2:0},value:'number'});let n=cell(s,7,0,'hello');assert.ok(n.error);assert.equal(n.doc.sheets[0].cells[7][0],'');s=cell(s,7,0,'4');assert.equal(s.doc.sheets[0].cells[7][0],'4');s=apply(s,{type:'checkbox',range:{r1:8,r2:8,c1:0,c2:1}});assert.equal(s.doc.sheets[0].cells[8][1],'FALSE');assert.equal(s.doc.sheets[0].formats.B9.checkbox,true);
});
test('restricted formulas calculate refs, ranges and arithmetic and recalculate dependencies',()=>{
  let s=state(), sh=s.doc.sheets[0];assert.equal(cellValue(sh,1,4),'360');assert.equal(cellValue(sh,4,4),'1340');s=cell(s,1,2,'10');assert.equal(cellValue(s.doc.sheets[0],4,4),'2180');s=cell(s,7,0,'=(C2+2)*3/2');assert.equal(cellValue(s.doc.sheets[0],7,0),'18');s=cell(s,7,1,'=AVERAGE(C2:C4)');assert.equal(cellValue(s.doc.sheets[0],7,1),'5.6666666667');
});
test('unsupported formulas, references, cycles and divide-by-zero remain explicit',()=>{
  let s=state();for(const [value,expected] of [['=1/0','#DIV/0!'],['=A999','#REF!'],['=fetch(1)','#UNSUPPORTED!'],['=SUM(A99:A100)','#REF!'],['=1+','#FORMULA!'],['=A8','#CYCLE!']]){s=cell(s,7,0,value);assert.equal(cellValue(s.doc.sheets[0],7,0),expected,value);}
  s=cell(s,7,0,'=B8');s=cell(s,7,1,'=A8');assert.equal(cellValue(s.doc.sheets[0],7,0),'#CYCLE!');
});
test('number display changes presentation without modifying raw value',()=>{
  let s=cell(state(),7,0,'0.25');s=apply(s,{type:'format',range:{r1:7,r2:7,c1:0,c2:0},patch:{numberFormat:'percent',decimals:1}});assert.equal(displayCell(s.doc.sheets[0],7,0),'25.0%');assert.equal(s.doc.sheets[0].cells[7][0],'0.25');
});
test('slide insertion duplication visibility and last-delete safety',()=>{
  let s=createOfficeHistory('pptx'), id=s.doc.slides[0].id;const go=a=>s=editOffice(s,{slideId:id,...a},ppt);go({type:'slide-duplicate'});assert.equal(s.doc.slides.length,4);assert.notEqual(s.doc.slides[1].id,id);go({type:'slide-hidden'});assert.equal(s.doc.slides[0].hidden,true);while(s.doc.slides.length>1)go({type:'slide-delete',slideId:s.doc.slides.at(-1).id});go({type:'slide-delete',slideId:s.doc.slides[0].id});assert.equal(s.doc.slides.length,1);assert.ok(s.error);
});
test('PPT object insertion properties table and layer actions serialize',()=>{
  let s=createOfficeHistory('pptx'), slideId=s.doc.slides[0].id;for(const kind of ['text','image','shape','table','chart'])s=editOffice(s,{type:'element-insert',slideId,kind},ppt);
  let el=s.doc.slides[0].elements.at(-1);s=editOffice(s,{type:'element-update',slideId,elementId:el.id,patch:{x:999,y:-10,fontSize:999,opacity:0,chartType:'line'}},ppt);el=s.doc.slides[0].elements.at(-1);assert.equal(el.x,600);assert.equal(el.y,0);assert.equal(el.fontSize,96);assert.equal(el.opacity,0);
  s=editOffice(s,{type:'element-layer',slideId,elementId:el.id,direction:'back'},ppt);assert.equal(s.doc.slides[0].elements[0].id,el.id);
  const table=s.doc.slides[0].elements.find(e=>e.kind==='table');s=editOffice(s,{type:'table-cell',slideId,elementId:table.id,row:1,col:1,value:'42'},ppt);assert.equal(s.doc.slides[0].elements.find(e=>e.id===table.id).cells[1][1],'42');assert.deepEqual(createOfficeDocument('pptx',serializeOffice(s.doc)),s.doc);
});
test('slide notes and title update participate in undo',()=>{
  let s=createOfficeHistory('pptx'), slide=s.doc.slides[0];s=editOffice(s,{type:'slide-notes',slideId:slide.id,value:'新的备注'},ppt);s=editOffice(s,{type:'element-update',slideId:slide.id,elementId:slide.elements[0].id,patch:{text:'新的标题\n内容'}},ppt);assert.equal(s.doc.slides[0].title,'新的标题');s=editOffice(s,{type:'undo'},ppt);assert.equal(s.doc.slides[0].notes,'新的备注');assert.equal(s.doc.slides[0].title,slide.title);
});
test('PPT verified shortcut guards exclude input, IME, repeat, double primary and wrong modifiers',()=>{
  assert.equal(presentationShortcut({key:'1',code:'Digit1',shiftKey:true}),'fit');assert.equal(presentationShortcut({key:'0',metaKey:true}),'actual');assert.equal(presentationShortcut({key:'1',code:'Digit1',ctrlKey:true,altKey:true}),'grid');assert.equal(presentationShortcut({key:'+',metaKey:true,shiftKey:true}),'zoom-in');assert.equal(presentationShortcut({key:'-',ctrlKey:true}),'zoom-out');
  for(const patch of [{editableTarget:true},{isComposing:true},{repeat:true},{defaultPrevented:true},{ctrlKey:true},{altKey:true},{shiftKey:true}])assert.equal(presentationShortcut({key:'0',metaKey:true,...patch}),null);
});
