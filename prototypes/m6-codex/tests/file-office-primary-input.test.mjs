import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficeHistory,editOffice,officeCapabilities} from '../src/file-office-model.mjs';

const caps=officeCapabilities('xlsx',{sourceState:'live',manualEditUiEnabled:true});
const range={r1:1,r2:2,c1:1,c2:2};
const apply=(state,action)=>editOffice(state,{sheetId:state.doc.sheets[0].id,...action},caps);

test('primary range input preserves literal formulas, other cells and styles as one undo entry',()=>{
  const original=createOfficeHistory('xlsx');
  const styled=apply(original,{type:'format',range,patch:{bold:true,fill:'#aabbcc'}});
  const changed=apply(styled,{type:'input-range',range,value:'=A1'});
  for(let row=1;row<=2;row++)for(let col=1;col<=2;col++)assert.equal(changed.doc.sheets[0].cells[row][col],'=A1');
  assert.deepEqual(changed.doc.sheets[0].formats,styled.doc.sheets[0].formats);
  assert.equal(changed.doc.sheets[0].cells[0][0],styled.doc.sheets[0].cells[0][0]);
  assert.equal(changed.past.length,styled.past.length+1);
  assert.deepEqual(apply(changed,{type:'undo'}).doc,styled.doc);
  assert.deepEqual(apply(apply(changed,{type:'undo'}),{type:'redo'}).doc,changed.doc);
  assert.equal(apply(changed,{type:'input-range',range,value:'=A1'}),changed);
});

test('a rejected range input preserves every target and the undo history',()=>{
  const original=createOfficeHistory('xlsx');
  const constrained=apply(original,{type:'validation',range:{r1:2,r2:2,c1:2,c2:2},value:'number'});
  const rejected=apply(constrained,{type:'input-range',range,value:'not a number'});
  assert.ok(rejected.error);
  assert.deepEqual(rejected.doc,constrained.doc);
  assert.deepEqual(rejected.past,constrained.past);
});
