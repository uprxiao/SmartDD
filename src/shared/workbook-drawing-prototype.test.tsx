// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
// @ts-expect-error Prototype producer is JavaScript and synthetic JSON only.
import {FileOfficePreview} from '../../prototypes/m6-codex/src/FileOfficePreview';
// @ts-expect-error Prototype pure model is JavaScript.
import {createOfficeHistory,serializeOffice} from '../../prototypes/m6-codex/src/file-office-model.mjs';
import {WORKBOOK_CHARTS,WORKBOOK_SHAPES} from './file-workbook-drawing';
const hostOptions={sourceKind:'local',sourceState:'live',isEditing:true,manualEditUiEnabled:true};
beforeEach(()=>{vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId:number;constructor(type:string,init:PointerEventInit){super(type,init);this.pointerId=init.pointerId??1;}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(){
 const doc=createOfficeHistory('xlsx').doc;doc.sheets[0].cells[0]=['分类','First','Second'];doc.sheets[0].cells[1]=['1','42','2'];doc.sheets[0].cells[2]=['2','43','8'];const draft=vi.fn();
 const view=render(<FileOfficePreview kind="xlsx" initialValue={serializeOffice(doc)} hostOptions={hostOptions} onDraft={draft}/>);
 const area=view.container.querySelector('.fo-viewport')!;Object.defineProperties(area,{clientWidth:{value:500,configurable:true},clientHeight:{value:420,configurable:true}});return{...view,draft};
}
function selectData(){fireEvent.pointerDown(screen.getByRole('gridcell',{name:'单元格 A1'}),{button:0,buttons:1,clientX:10,clientY:10});fireEvent.pointerEnter(screen.getByRole('gridcell',{name:'单元格 C3'}));fireEvent.pointerMove(screen.getByRole('gridcell',{name:'单元格 C3'}),{buttons:1,clientX:50,clientY:50});fireEvent.pointerUp(window);expect(screen.getByLabelText('当前选区').textContent).toBe('A1:C3');}
it('inserts all five real chart choices from the selected synthetic cells and gates cell formatting on floating selection',()=>{
 const f=setup();selectData();const names={bar:'柱状图',line:'折线图',pie:'饼图',area:'面积图',scatter:'散点图'};
 for(const kind of WORKBOOK_CHARTS){fireEvent.click(screen.getByRole('button',{name:'插入工作簿图表'}));fireEvent.click(screen.getByRole('menuitem',{name:names[kind]}));}
 const doc=JSON.parse(f.draft.mock.calls.at(-1)![0]),objects=doc.sheets[0].objects.filter((o:{frame?:unknown;kind:string})=>o.frame&&o.kind==='chart');expect(objects.map((o:{chartType:string})=>o.chartType)).toEqual([...WORKBOOK_CHARTS]);for(const object of objects)expect(object.sourceRange).toEqual({r1:0,c1:0,r2:2,c2:2});
 expect(screen.getAllByRole('button',{name:/选择图表/})).toHaveLength(5);expect((screen.getByRole('button',{name:'格式'})as HTMLButtonElement).disabled).toBe(true);
});
it('uses the original twelve shape choices without changing selected cells',()=>{
 const f=setup();const names={ellipse:'圆形',rect:'矩形',triangle:'三角形',diamond:'菱形',star5:'星形',rightArrow:'右箭头',leftArrow:'左箭头',plus:'加号',chevron:'V形箭头',wedgeRoundRectCallout:'标注',line:'直线',lineInv:'斜箭头'};
 for(const shape of WORKBOOK_SHAPES){fireEvent.click(screen.getByRole('button',{name:'插入工作簿形状'}));fireEvent.click(screen.getByRole('menuitem',{name:names[shape]}));}
 const doc=JSON.parse(f.draft.mock.calls.at(-1)![0]);expect(doc.sheets[0].objects.filter((o:{frame?:unknown;kind:string})=>o.frame&&o.kind==='shape').map((o:{shape:string})=>o.shape)).toEqual([...WORKBOOK_SHAPES]);expect(doc.sheets[0].cells[1]).toEqual(['1','42','2','','','']);
});
it('places before text input, retains raw synthetic draft during composition and commits only after composition ends',async()=>{
 const f=setup();fireEvent.click(screen.getByRole('button',{name:'插入工作簿文本框'}));const area=screen.getByRole('region',{name:'放置文本框'});expect(f.draft).not.toHaveBeenCalled();fireEvent.keyDown(area,{key:'Enter'});
 const input=await screen.findByRole('textbox',{name:'编辑工作簿文本框'});const placed=JSON.parse(f.draft.mock.calls.at(-1)![0]).sheets[0].objects.at(-1);expect(placed).toMatchObject({kind:'text',autoSize:true,text:'',frame:{x:176,y:168.5,width:112,height:56}});
 fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'中文\nhello'}});fireEvent.keyDown(input,{key:'Enter',metaKey:true,isComposing:true});expect(screen.getByRole('textbox',{name:'编辑工作簿文本框'})).toBe(input);expect(JSON.parse(f.draft.mock.calls.at(-1)![0]).sheets[0].objects.at(-1).text).toBe('中文\nhello');
 fireEvent.compositionEnd(input);fireEvent.keyDown(input,{key:'Enter',metaKey:true});expect(screen.queryByRole('textbox',{name:'编辑工作簿文本框'})).toBeNull();expect(JSON.parse(f.draft.mock.calls.at(-1)![0]).sheets[0].objects.at(-1)).toMatchObject({id:placed.id,text:'中文\nhello'});
 fireEvent.click(screen.getByRole('button',{name:'撤销示例修改'}));expect(JSON.parse(f.draft.mock.calls.at(-1)![0]).sheets[0].objects.at(-1).text).toBe('');fireEvent.click(screen.getByRole('button',{name:'重做示例修改'}));expect(JSON.parse(f.draft.mock.calls.at(-1)![0]).sheets[0].objects.at(-1).text).toBe('中文\nhello');
});
it('a floating-selection layout change cannot turn a stationary cell click into a dragged range',()=>{
 setup();fireEvent.click(screen.getByRole('button',{name:'插入工作簿形状'}));fireEvent.click(screen.getByRole('menuitem',{name:'矩形'}));
 const a1=screen.getByRole('gridcell',{name:'单元格 A1'}),a2=screen.getByRole('gridcell',{name:'单元格 A2'});
 fireEvent.pointerDown(a1,{button:0,buttons:1,pointerId:8,clientX:100,clientY:100});
 // Pointer enter can be emitted by layout movement even when the physical cursor is stationary.
 fireEvent.pointerEnter(a2,{buttons:1,pointerId:8,clientX:100,clientY:100});fireEvent.pointerUp(window,{pointerId:8});
 expect(screen.getByLabelText('当前选区').textContent).toBe('A1');
});
it('an actual pointer drag starts only after movement and still extends the original range',()=>{
 setup();const a1=screen.getByRole('gridcell',{name:'单元格 A1'}),c3=screen.getByRole('gridcell',{name:'单元格 C3'});
 fireEvent.pointerDown(a1,{button:0,buttons:1,pointerId:9,clientX:10,clientY:10});fireEvent.pointerEnter(c3,{buttons:1,pointerId:9,clientX:10,clientY:10});
 fireEvent.pointerMove(c3,{buttons:1,pointerId:9,clientX:12,clientY:10});expect(screen.getByLabelText('当前选区').textContent).toBe('A1');
 fireEvent.pointerMove(c3,{buttons:1,pointerId:9,clientX:35,clientY:40});fireEvent.pointerUp(window,{pointerId:9});expect(screen.getByLabelText('当前选区').textContent).toBe('A1:C3');
});
