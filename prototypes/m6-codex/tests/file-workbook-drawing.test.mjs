import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficeHistory,editOffice,workbookDrawingModel,serializeOffice} from '../src/file-office-model.mjs';
const caps={editable:true,format:true};
const fixture=()=>{const state=createOfficeHistory('xlsx');state.doc.sheets[0].cells[0]=['分类','First','Second'];state.doc.sheets[0].cells[1]=['1','42','2'];state.doc.sheets[0].cells[2]=['2','43','8'];return state;};
const range={r1:0,c1:0,r2:2,c2:2};
test('synthetic charts bind their original selected values and headers across edits, gaps and JSON reopen',()=>{
 for(const chartType of ['bar','line','pie','area','scatter']){
  let state=fixture();const sheetId=state.doc.sheets[0].id;state=editOffice(state,{type:'insert-sheet-object',kind:'chart',chartType,sheetId,range},caps);assert.equal(state.error,null);const id=state.doc.sheets[0].objects.at(-1).id;
  state=editOffice(state,{type:'cell',sheetId,row:1,col:1,value:'91'},caps);let sheet=state.doc.sheets[0],object=sheet.objects.find(o=>o.id===id);assert.deepEqual(workbookDrawingModel(object,sheet).chart.series[0].values,[91,43]);
  state=editOffice(state,{type:'cell',sheetId,row:0,col:1,value:''},caps);sheet=state.doc.sheets[0];object=sheet.objects.find(o=>o.id===id);assert.equal(workbookDrawingModel(object,sheet).chart.categories.length,2);
  const reopened=createOfficeHistory('xlsx',serializeOffice(state.doc));sheet=reopened.doc.sheets[0];assert.deepEqual(workbookDrawingModel(sheet.objects.find(o=>o.id===id),sheet).chart.series[0].values,[91,43]);
 }
});
test('text placement/text edit participate in JSON undo/redo and respect readonly/manual gates',()=>{
 let state=fixture();const sheetId=state.doc.sheets[0].id,action={type:'insert-sheet-object',kind:'text',sheetId,range,frame:{x:10,y:20,width:112,height:56},autoSize:true};
 assert.match(editOffice(state,action,{editable:true,format:false}).error,/尚未启用/);state=editOffice(state,action,caps);const id=state.doc.sheets[0].objects.at(-1).id;state=editOffice(state,{type:'sheet-object-text',sheetId,objectId:id,text:'中文\nhello'},caps);assert.equal(state.doc.sheets[0].objects.at(-1).text,'中文\nhello');state=editOffice(state,{type:'undo'},caps);assert.equal(state.doc.sheets[0].objects.at(-1).text,'');state=editOffice(state,{type:'redo'},caps);assert.equal(state.doc.sheets[0].objects.at(-1).text,'中文\nhello');
});
test('invalid selections and unsupported chart choices report failure without inserting demo data',()=>{
 const state=fixture(),sheetId=state.doc.sheets[0].id,before=serializeOffice(state.doc);assert.match(editOffice(state,{type:'insert-sheet-object',kind:'chart',chartType:'bar',sheetId,range:{r1:0,c1:0,r2:0,c2:0}},caps).error,/数值/);assert.match(editOffice(state,{type:'insert-sheet-object',kind:'chart',chartType:'histogram',sheetId,range},caps).error,/尚未启用/);assert.equal(serializeOffice(state.doc),before);
});
