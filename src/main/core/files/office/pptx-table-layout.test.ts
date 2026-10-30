import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { OfficeXml,children,descendants } from './xml';
import { pptxTableLayoutSource,readPptxTableLayout } from './pptx-table-layout';
import { editPptx } from './pptx-edit';
const fixture=async()=>new OfficePagesModel(await OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')));
const marker={slideId:'256',elementId:'5',row:0,column:0};
const source={width:720,height:405,markers:new Map([['010001',marker]])};
const path='<path fill="rgb(1,0,1)" stroke="none" d="M 100,200 L 300,200 300,400 100,400 100,200 Z "/>';
const svg=(content=path,attributes='')=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 405"><g class="com.sun.star.drawing.TableShape" ${attributes}>${content}</g></svg>`);
describe('PPTX native table geometry projection',()=>{
  it('marks only private cell fill and preserves source hashes, rows, text and all other parts',async()=>{
    const model=await fixture(),hashes=model.packageData.hashes(),snapshot=pptxTableLayoutSource(model),part='ppt/slides/slide1.xml';
    expect(snapshot.markers.size).toBe(6);expect(model.packageData.hashes()).toEqual(hashes);
    for(const name of model.packageData.names())if(name!==part)expect(snapshot.packageData.hashes()[name],name).toBe(hashes[name]);
    const before=new OfficeXml(model.packageData.read(part)),after=new OfficeXml(snapshot.packageData.read(part)),drawing='http://schemas.openxmlformats.org/drawingml/2006/main';
    expect(descendants(after.root,'txBody',drawing).map(node=>after.slice(node))).toEqual(descendants(before.root,'txBody',drawing).map(node=>before.slice(node)));
    expect(descendants(after.root,'tr',drawing).map(node=>node.attributes.h.value)).toEqual(['0','0','0']);
    expect(descendants(after.root,'tcPr',drawing).flatMap(node=>children(node,'solidFill',drawing).flatMap(fill=>children(fill,'srgbClr',drawing).map(color=>color.attributes.val.value)))).toEqual(['010001','010002','010003','010004','010005','010006']);
  });
  it('exposes hidden pages only in the private measurement copy',async()=>{
    let file=(await fixture()).packageData;file=editPptx(file,{type:'hidden',slideId:'256',hidden:true}).packageData;
    const hashes=file.hashes(),model=new OfficePagesModel(file),marked=pptxTableLayoutSource(model);
    expect(model.info.slides[0].hidden).toBe(true);expect(new OfficePagesModel(marked.packageData).info.slides[0].hidden).toBe(false);expect(file.hashes()).toEqual(hashes);
  });
  it('reads exact native cell polygons independently of source automatic heights',()=>{
    expect(readPptxTableLayout(svg(),source)).toEqual([{slideId:'256',elementId:'5',cells:[{row:0,column:0,points:[[100,200],[300,200],[300,400],[100,400]]}]}]);
    const rotated=path.replace('100,200 L 300,200 300,400 100,400 100,200','100,200 L 200,300 100,400 0,300 100,200');
    expect(readPptxTableLayout(svg(rotated),source)[0].cells[0].points[3]).toEqual([0,300]);
  });
  it('accepts only the fixed inert doctype and never resolves external entities or SVG scripts',()=>{
    const declaration='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n';
    expect(readPptxTableLayout(Buffer.concat([Buffer.from(declaration),svg(path+'<script><![CDATA[throw new Error("never execute")]]></script>')]),source)).toHaveLength(1);
    for(const dtd of ['<!DOCTYPE svg SYSTEM "file:///outside">','<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///outside">]>'])expect(()=>readPptxTableLayout(Buffer.concat([Buffer.from(dtd),svg()]),source)).toThrow('DTD');
  });
  it('rejects missing/duplicate markers, unknown transforms, curves and broken polygons',()=>{
    expect(()=>readPptxTableLayout(svg(''),source)).toThrow('未定位');expect(()=>readPptxTableLayout(svg(path+path),source)).toThrow('重复');expect(()=>readPptxTableLayout(svg(path,'transform="translate(10)"'),source)).toThrow('坐标变换');
    expect(()=>readPptxTableLayout(svg(path.replace(' L ',' C ')),source)).toThrow('格式');expect(()=>readPptxTableLayout(svg(path.replace('300,400','350,400')),source)).toThrow('四边形');
    expect(()=>readPptxTableLayout(svg(path.replace('100,200 Z','101,200 Z')),source)).toThrow('闭合');
    expect(()=>readPptxTableLayout(Buffer.from(svg().toString().replace('720 405','100 405')),source)).toThrow('纵横比');
    expect(()=>readPptxTableLayout(Buffer.from(svg().toString().replace('720 405','0.00072 0.000405')),source)).toThrow('预算');
  });
});
