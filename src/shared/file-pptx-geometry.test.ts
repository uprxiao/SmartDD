import { describe,expect,it } from 'vitest';
import type { PptxElementInfo } from './file-pptx-elements';
import { pptxPageBoxes } from './file-pptx-geometry';
const group:PptxElementInfo={id:'1',kind:'group',name:'Group',hidden:false,box:{x:100,y:200,width:200,height:100,rotation:0,flipH:false,flipV:false},childFrame:{x:20,y:30,width:100,height:100}};
const child:PptxElementInfo={id:'2',parentId:'1',kind:'shape',name:'Rect',hidden:false,box:{x:30,y:40,width:40,height:20,rotation:90,flipH:false,flipV:false}};
describe('DrawingML group page coordinates',()=>{
  it('keeps original coordinates and maps centre, independent extents and rotation without affine shear',()=>{
    const result=pptxPageBoxes([group,child]);
    expect(result.get('1')).toEqual(group.box);
    expect(result.get('2')).toEqual({x:120,y:210,width:80,height:20,rotation:90,flipH:false,flipV:false});
    expect(child.box).toMatchObject({x:30,y:40,width:40,height:20});
  });
  it('rotates the mapped centre and combines group flips independently of source child properties',()=>{
    const parent={...group,box:{...group.box!,rotation:90,flipH:true}},box=pptxPageBoxes([parent,child]).get('2')!;
    expect(box.x).toBeCloseTo(190,10);expect(box.y).toBeCloseTo(280,10);
    expect(box).toMatchObject({width:80,height:20,rotation:0,flipH:true,flipV:false});
  });
  it('supports nested groups and omits unresolved, cyclic or hidden ancestor geometry',()=>{
    const outer:PptxElementInfo={id:'0',kind:'group',name:'Outer',hidden:false,box:{x:0,y:0,width:800,height:800,rotation:0,flipH:false,flipV:false},childFrame:{x:0,y:0,width:400,height:400}};
    expect(pptxPageBoxes([outer,{...group,parentId:'0'},child]).get('2')).toMatchObject({x:240,y:420,width:160,height:40,rotation:90});
    for(const parent of [{...group,childFrame:undefined},{...group,parentId:'2'},{...group,hidden:true}])expect(pptxPageBoxes([parent,child]).has('2')).toBe(false);
  });
});
