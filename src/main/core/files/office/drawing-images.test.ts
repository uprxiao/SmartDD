import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';
import {OfficePackage} from './package';
import {OfficeDocument} from './document';
import {OfficeXml,children} from './xml';

const drawing='xl/drawings/drawing1.xml',rels='xl/drawings/_rels/drawing1.xml.rels';
const fixture=()=>readFile(new URL('./__fixtures__/ordinary-drawing.xlsx',import.meta.url)).then(bytes=>OfficePackage.read(bytes));
const page=(file:OfficePackage)=>new OfficeDocument(file).workbook.window('1',0,0,6,6);
const replace=(file:OfficePackage,part:string,source:string)=>file.patch(new Map([[part,Buffer.from(source)]]),{changed:[part],added:[],removed:[]});

describe('original worksheet image projection',()=>{
  it('keeps stable part identities, geometry and media hashes through read-only materialization',async()=>{
    const file=await fixture(),hashes=file.hashes(),document=new OfficeDocument(file),initial=document.state();
    const image=document.workbook.window('1',0,0,6,6).objects![0];
    expect(image).toMatchObject({kind:'image',name:'Public teal square',source:{part:drawing,id:'2'},media:{part:'xl/media/image1.png',sha256:hashes['xl/media/image1.png']},anchor:{kind:'twoCellAnchor',from:{row:1,column:3,x:0,y:0},to:{row:5,column:5,x:0,y:0}}});
    const roundtrip=await OfficePackage.read((await document.materialize(0)).bytes);
    expect(page(roundtrip).objects).toEqual([image]);expect(file.hashes()).toEqual(hashes);expect(roundtrip.hashes()).toEqual(hashes);expect(document.state()).toEqual(initial);
    // The owned media endpoint and real image layer now support this ordinary
    // picture. Charts/unsupported effects keep their separate warning tests.
    expect(page(file).drawingWarning).toBeUndefined();
  });

  it('projects one-cell and absolute anchors without inventing cell endpoints',async()=>{
    const file=await fixture(),xml=new OfficeXml(file.read(drawing)),old=xml.root.children[0],pic=children(old,'pic')[0];
    const one=`<xdr:oneCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="476250"/>${xml.slice(pic)}<xdr:clientData/></xdr:oneCellAnchor>`;
    const single=file.patch(new Map([[drawing,xml.edit([{start:old.start,end:old.end,value:one}])]]),{changed:[drawing],added:[],removed:[]});
    expect(page(single).objects![0].anchor).toEqual({kind:'oneCellAnchor',from:{row:1,column:3,x:2,y:3},extent:{width:100,height:50}});
    const absolute=one.replace(/<xdr:oneCellAnchor>/,'<xdr:absoluteAnchor>').replace('</xdr:oneCellAnchor>','</xdr:absoluteAnchor>').replace(/<xdr:from>[\s\S]*?<\/xdr:from>/,'<xdr:pos x="19050" y="28575"/>');
    const floating=file.patch(new Map([[drawing,xml.edit([{start:old.start,end:old.end,value:absolute}])]]),{changed:[drawing],added:[],removed:[]});
    expect(page(floating).objects![0].anchor).toEqual({kind:'absoluteAnchor',position:{x:2,y:3},extent:{width:100,height:50}});
    expect(page(floating).objects![0].id).toBe(page(file).objects![0].id);
  });

  it('never follows external images or borrows a picture from an unreferenced part',async()=>{
    const file=await fixture(),external=replace(file,rels,file.read(rels).toString().replace('Target="../media/image1.png"','Target="https://example.invalid/never-fetch.png" TargetMode="External"'));
    expect(page(external).objects).toBeUndefined();expect(page(external).drawingWarning).toBeTruthy();expect(external.hashes()[drawing]).toBe(file.hashes()[drawing]);
    const sheet='xl/worksheets/sheet1.xml',xml=new OfficeXml(file.read(sheet)),node=children(xml.root,'drawing')[0];
    const removed=file.patch(new Map([[sheet,xml.edit([{start:node.start,end:node.end,value:''}])]]),{changed:[sheet],added:[],removed:[]});
    expect(removed.has(drawing)).toBe(true);expect(page(removed).objects).toBeUndefined();
  });

  it('does not fabricate a selectable identity from duplicate IDs or malformed geometry',async()=>{
    const file=await fixture(),xml=new OfficeXml(file.read(drawing)),node=xml.root.children[0];
    const duplicate=file.patch(new Map([[drawing,xml.edit([{start:node.end,end:node.end,value:xml.slice(node)}])]]),{changed:[drawing],added:[],removed:[]});
    expect(page(duplicate).objects).toBeUndefined();expect(page(duplicate).drawingWarning).toBeTruthy();
    const malformed=replace(file,drawing,file.read(drawing).toString().replace('<xdr:row>5</xdr:row>','<xdr:row>0</xdr:row>'));
    expect(page(malformed).objects).toBeUndefined();expect(page(malformed).cells.find(cell=>cell.address==='B2')?.value).toBe('42');expect(page(malformed).drawingWarning).toBeTruthy();
  });
});
