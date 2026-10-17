#!/usr/bin/env python3
"""Isolated OOXML candidate adapter. POI is calculation-only, never the package writer.
Explicitly expands shared formula groups before calculation (POI 5.5.1 loses 3D refs
in these shared tokens). Rejects unregistered formula storage; no eval()/network.
"""
import importlib.util,pathlib,copy,re,posixpath
from openpyxl.formula.tokenizer import Tokenizer
from openpyxl.formula.translate import Translator
from openpyxl.utils.cell import range_boundaries, get_column_letter
from lxml import etree as ET
HERE=pathlib.Path(__file__).resolve();sp=importlib.util.spec_from_file_location('a',HERE.with_name('office-actions-probe.py'));a=importlib.util.module_from_spec(sp);sp.loader.exec_module(a)
S,O,R,C=a.S,a.O,a.R,a.C;tree,xml=a.tree,a.xml

def shared_expand(parts):
 out=dict(parts);expanded=[]
 for name,doc in a.formula_parts(parts):
  if not name.startswith('xl/worksheets/'):continue
  cells=doc.findall('.//{%s}c'%S);masters={}
  for c in cells:
   f=c.find('{%s}f'%S)
   if f is not None and f.get('t')=='shared' and f.text:masters[f.get('si')]=(c.get('r'),f.text)
  dirty=False
  for c in cells:
   f=c.find('{%s}f'%S)
   if f is None:continue
   if f.get('t')=='dataTable':raise ValueError('dataTable formula requires separate adapter')
   if f.get('t')=='shared':
    origin,text=masters[f.get('si')];f.text=Translator('='+text,origin=origin).translate_formula(c.get('r'))[1:];f.attrib.clear();dirty=True;expanded.append({'part':name,'cell':c.get('r'),'formula':f.text})
  if dirty:out[name]=xml(doc)
 return out,expanded

def decode_sheet(value):return value[1:-1].replace("''", "'") if value.startswith("'") and value.endswith("'") else value

def token_rewrite(text,old,new,sheetnames,removed_tables):
 prefix=text.startswith('=');tokens=Tokenizer(text if prefix else '='+text).items;changed=False
 for t in tokens:
  if t.type!='OPERAND' or t.subtype!='RANGE':continue
  value=t.value
  if any(value.startswith(table+'[') for table in removed_tables):t.value='#REF!';changed=True;continue
  if '!' not in value:continue
  head,cell=value.rsplit('!',1)
  if '[' in head or ']' in head:raise ValueError('external workbook dependency: no external reads permitted')
  decoded=decode_sheet(head)
  if ':' in decoded:
   first,last=decoded.split(':',1)
   if old not in sheetnames[min(sheetnames.index(first),sheetnames.index(last)):max(sheetnames.index(first),sheetnames.index(last))+1]:continue
   if new is not None:
    if first==old:first=new
    if last==old:last=new
   else:
    group=sheetnames[min(sheetnames.index(first),sheetnames.index(last)):max(sheetnames.index(first),sheetnames.index(last))+1];remaining=[x for x in group if x!=old]
    if not remaining:t.value='#REF!';changed=True;continue
    first,last=remaining[0],remaining[-1]
   head=first if first==last else first+':'+last;t.value="'"+head.replace("'","''")+"'!"+cell;changed=True
  elif decoded.casefold()==old.casefold():
   t.value='#REF!' if new is None else "'"+new.replace("'","''")+"'!"+cell;changed=True
 return ('=' if prefix else '')+''.join(t.value for t in tokens),changed

def mutate(parts,old,new):
 """new=None deletes; string renames; preserve all unrelated ZIP part bytes."""
 out,expanded=shared_expand(parts);wb,sheets=a.sheet_nodes(out);names=[s.get('name') for s in sheets];removed=set();removed_tables=set();edits=[]
 if new is None:
  # Reuse the graph deletion skeleton after temporarily preserving dependencies;
  # this variant handles them below and never invokes old restrictive rewrite.
  target=next(s for s in sheets if s.get('name')==old);index=names.index(old)
  if len(sheets)<=1 or not any(s is not target and s.get('state','visible')=='visible' for s in sheets):raise ValueError('must retain visible sheet')
  rels=tree(out[a.WR]);rel=next(r for r in rels if r.get('Id')==target.get('{%s}id'%O));tar=rel.get('Target');path=tar.lstrip('/') if tar.startswith('/') else posixpath.normpath(posixpath.join('xl',tar))
  candidates=a.reachable(out,[path])
  for p in candidates:
   if p.startswith('xl/tables/') and p.endswith('.xml'):removed_tables.add(tree(out[p]).get('name'))
  sheets.remove(target);rels.remove(rel)
  for node in list(wb.findall('.//{%s}definedName'%S)):
   local=node.get('localSheetId')
   if local is not None:
    if int(local)==index:node.getparent().remove(node)
    elif int(local)>index:node.set('localSheetId',str(int(local)-1))
  for view in wb.findall('.//{%s}workbookView'%S):
   for key in ['activeTab','firstSheet']:
    n=int(view.get(key,'0'));view.set(key,str(n-1 if n>index else min(n,len(sheets)-1)))
  out[a.W]=xml(wb);out[a.WR]=xml(rels);removed=candidates-a.reachable(out,['_rels/.rels'])
  for p in removed:del out[p]
  types=tree(out['[Content_Types].xml'])
  for n in list(types):
   if n.get('PartName','').lstrip('/') in removed:types.remove(n)
  out['[Content_Types].xml']=xml(types)
 else:
  if any(s.get('name').casefold()==new.casefold() for s in sheets):raise ValueError('duplicate sheet')
  if not new or len(new.encode('utf-16-le'))//2>31 or re.search(r'[\\/?*\[\]:]',new):raise ValueError('invalid name')
  next(s for s in sheets if s.get('name')==old).set('name',new);out[a.W]=xml(wb)
 for name,doc in a.formula_parts(out):
  dirty=False
  for node in doc.iter():
   if ET.QName(node).localname not in a.FORMULA_NAMES or not node.text:continue
   prev=node.text;cur,d=token_rewrite(prev,old,new,names,removed_tables)
   if d:node.text=cur;dirty=True;edits.append({'part':name,'before':prev,'after':cur})
  if dirty:
   for c in doc.findall('.//{%s}c'%S):
    if c.find('{%s}f'%S) is not None:
     v=c.find('{%s}v'%S)
     if v is not None:c.remove(v)
     if c.get('t')=='e':c.attrib.pop('t')
   out[name]=xml(doc)
 # calcChain requires invalidation at dependency mutation, never reuse old chain.
 if 'xl/calcChain.xml' in out:
  del out['xl/calcChain.xml'];removed.add('xl/calcChain.xml');rels=tree(out[a.WR]);types=tree(out['[Content_Types].xml'])
  for r in list(rels):
   if r.get('Type')==O+'/calcChain':rels.remove(r)
  for n in list(types):
   if n.get('PartName')=='/xl/calcChain.xml':types.remove(n)
  out[a.WR]=xml(rels);out['[Content_Types].xml']=xml(types)
 wb=tree(out[a.W]);cp=wb.find('{%s}calcPr'%S)
 if cp is None:cp=ET.SubElement(wb,'{%s}calcPr'%S)
 cp.set('fullCalcOnLoad','1');cp.set('forceFullCalc','1');out[a.W]=xml(wb)
 return out,{'sharedExpanded':expanded,'dependencyEdits':edits,'removedParts':sorted(removed),'removedTables':sorted(removed_tables)}

def transplant_values(original,calculated):
 """Copy only computed t/v for existing formula/array-result cells, preserve f."""
 out=dict(original);changes=[]
 for name,doc in a.formula_parts(original):
  if not name.startswith('xl/worksheets/'):continue
  incoming=tree(calculated[name]);byaddr={c.get('r'):c for c in incoming.findall('.//{%s}c'%S)};dirty=False
  array_results=set()
  for f in doc.findall('.//{%s}f'%S):
   if f.get('t')=='array':
    x1,y1,x2,y2=range_boundaries(f.get('ref'))
    if (x2-x1+1)*(y2-y1+1)>10000:raise ValueError('array result budget exceeded')
    array_results.update(get_column_letter(x)+str(y) for x in range(x1,x2+1) for y in range(y1,y2+1))
  for c in doc.findall('.//{%s}c'%S):
   if c.find('{%s}f'%S) is None and c.get('r') not in array_results:continue
   inc=byaddr[c.get('r')];f=inc.find('{%s}f'%S);v=inc.find('{%s}v'%S)
   if (f is None and c.get('r') not in array_results) or v is None:raise ValueError('missing calculation result for '+c.get('r'))
   prev=c.find('{%s}v'%S)
   if prev is not None:c.remove(prev)
   c.append(copy.deepcopy(v));typ=inc.get('t')
   if typ:c.set('t',typ)
   else:c.attrib.pop('t',None)
   changes.append({'part':name,'cell':c.get('r'),'type':typ,'value':v.text});dirty=True
  if dirty:out[name]=xml(doc)
 return out,changes

def clone_pptx_mutable(parts):
 out,changed,added=a.base.duplicate_slide(parts)
 slide='ppt/slides/slide3.xml';rels_path='ppt/slides/_rels/slide3.xml.rels';rels=tree(out[rels_path]);ct=tree(out['[Content_Types].xml'])
 chart=next(r for r in rels if r.get('Type')==O+'/chart');assert chart.get('Target')=='../charts/chart1.xml'
 chart.set('Target','../charts/chart2.xml');out[rels_path]=xml(rels)
 out['ppt/charts/chart2.xml']=out['ppt/charts/chart1.xml'];cr=tree(out['ppt/charts/_rels/chart1.xml.rels'])
 embed=next(r for r in cr if r.get('Type')==O+'/package');embed.set('Target','../embeddings/chart-data2.xlsx')
 out['ppt/charts/_rels/chart2.xml.rels']=xml(cr);out['ppt/embeddings/chart-data2.xlsx']=out['ppt/embeddings/chart-data.xlsx']
 extra={'ppt/charts/chart2.xml','ppt/charts/_rels/chart2.xml.rels','ppt/embeddings/chart-data2.xlsx'};added|=extra
 for part,typ in [('ppt/charts/chart2.xml','application/vnd.openxmlformats-officedocument.drawingml.chart+xml'),('ppt/embeddings/chart-data2.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')]:
  ET.SubElement(ct,'{%s}Override'%C,{'PartName':'/'+part,'ContentType':typ})
 out['[Content_Types].xml']=xml(ct)
 return out,changed,added

def remove_slide(parts,index):
 out=dict(parts);P=a.base.P;pres=tree(out['ppt/presentation.xml']);ids=pres.find('{%s}sldIdLst'%P)
 if len(ids)<=1:raise ValueError('retain last slide')
 target=ids[index];rels=tree(out['ppt/_rels/presentation.xml.rels']);rel=next(r for r in rels if r.get('Id')==target.get('{%s}id'%O));path=posixpath.normpath(posixpath.join('ppt',rel.get('Target')))
 candidates=a.reachable(out,[path]);ids.remove(target);rels.remove(rel);out['ppt/presentation.xml']=xml(pres);out['ppt/_rels/presentation.xml.rels']=xml(rels)
 removed=candidates-a.reachable(out,['_rels/.rels'])
 for p in removed:del out[p]
 ct=tree(out['[Content_Types].xml'])
 for n in list(ct):
  if n.get('PartName','').lstrip('/') in removed:ct.remove(n)
 out['[Content_Types].xml']=xml(ct)
 return out,{'ppt/presentation.xml','ppt/_rels/presentation.xml.rels','[Content_Types].xml'},removed
