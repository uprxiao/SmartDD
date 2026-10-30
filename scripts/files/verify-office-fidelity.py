from pathlib import Path
import json,zipfile,hashlib,sys,io,struct,xml.etree.ElementTree as ET,copy,re
sha=lambda b:hashlib.sha256(b).hexdigest()
base=Path(sys.argv[1]);r=json.loads((base/'result.json').read_text());assert r['status']=='selected-functional-groups-passed'and len(r['checks'])==20
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
def package(data):
 with zipfile.ZipFile(io.BytesIO(data))as z:
  assert z.testzip()is None
  return {i.filename:z.read(i)for i in z.infolist()}
def canonical(node):return ET.tostring(node,encoding='unicode')
def coordinate(value):
 m=re.fullmatch(r'([A-Z]+)([0-9]+)',value);assert m
 column=0
 for char in m[1]:column=column*26+ord(char)-64
 return column,int(m[2])
checks=[]
for item in r['checks']:
 name=f"{item['theme']}-{item['mode']}.{item['kind']}";source=r['corpus'][name];path=Path(source['path']);data=path.read_bytes();s=path.stat();before=package(Path(source['fixture']['path']).read_bytes());after=package(data)
 if item['mode']!='normal':
  assert sha(data)==source['before']['sha256']and str(s.st_ino)==source['before']['inode']and str(s.st_mtime_ns)==source['before']['mtimeNs'],name
 else:
  assert set(before)==set(after);changed=[n for n in before if sha(before[n])!=sha(after[n])]
  if item['kind']=='xlsx':
   assert set(changed)<=set(['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/workbook.xml'])
   for part in [n for n in before if n.startswith('xl/worksheets/')and n.endswith('.xml')]:
    old=ET.fromstring(before[part]);new=ET.fromstring(after[part]);oldcells={c.attrib['r']:c for c in old.findall('.//s:c',ns)};newcells={c.attrib['r']:c for c in new.findall('.//s:c',ns)};assert set(oldcells)==set(newcells)
    arrays=[tuple(coordinate(x)for x in f.attrib['ref'].split(':'))for f in old.findall('.//s:f',ns)if f.attrib.get('t')=='array'and ':'in f.attrib.get('ref','')]
    for address,a in oldcells.items():
     b=newcells[address]
     if part=='xl/worksheets/sheet1.xml'and address=='B2':assert float(b.find('s:v',ns).text)==19 and b.find('s:f',ns)is None;continue
     x,y=coordinate(address);calculated=a.find('s:f',ns)is not None or any(c1<=x<=c2 and r1<=y<=r2 for((c1,r1),(c2,r2))in arrays)
     if calculated:
      af=a.find('s:f',ns);bf=b.find('s:f',ns);assert (af is None)==(bf is None)
      if af is not None:assert canonical(af)==canonical(bf)
      a=copy.deepcopy(a);b=copy.deepcopy(b)
      for x in [a,b]:
       x.attrib.pop('t',None)
       for v in list(x.findall('s:v',ns)):x.remove(v)
     assert canonical(a)==canonical(b),(name,part,address)
    # Array-formula follower caches are results, not independent input cells.
    # This fixture's D2:D3=Data!B2:B3*3 must change from stale caches to57/12.
    if part=='xl/worksheets/sheet2.xml':
     assert float(newcells['D2'].find('s:v',ns).text)==57
     assert float(newcells['D3'].find('s:v',ns).text)==12
    for tree in [old,new]:
     for parent in tree.iter():
      for child in list(parent):
       if child.tag=='{'+ns['s']+'}c':parent.remove(child)
    assert canonical(old)==canonical(new),(name,part,'non-cell structure')
   a=ET.fromstring(before['xl/workbook.xml']);b=ET.fromstring(after['xl/workbook.xml'])
   for x in [a,b]:
    for c in list(x.findall('s:calcPr',ns)):x.remove(c)
   assert canonical(a)==canonical(b)
  else:
   assert changed==['ppt/notesSlides/notesSlide1.xml'];new=ET.fromstring(after[changed[0]]);expected='Y13 '+item['theme']+' normal allowed notes 中文🙂';assert expected in [n.text for n in new.findall('.//a:t',ns)]
  checks.append({'file':name,'branch':'normal-edit','changedParts':changed,'sourceHash':sha(data),'nonTargetPartsExact':True})
 if item['mode']not in ['normal','signed']:
  raw=(base/f"{item['theme']}-{item['kind']}-{item['mode']}-draft.bin").read_bytes();start=raw.index(b'\n')+1;assert raw[:start]in [b'WYOFFICE1\n',b'WYPPTX4\n'];length=struct.unpack('<I',raw[start:start+4])[0];meta=json.loads(raw[start+4:start+4+length]);payload=raw[start+4+length:];assert len(payload)==meta['bytes'];assert sha(payload)==item['fault']['mutation']['beforeHash'];parts=package(payload)
  assert {n:sha(v)for n,v in parts.items()}==item['fault']['mutation']['beforeParts'];assert parts['customXml/vbaProject.bin']==before['customXml/vbaProject.bin']
  checks.append({'file':name,'branch':'blocked-source-and-durable-draft','sourceUnchanged':True,'safeDraftHash':sha(payload),'safeDraftMatchesLegalWorkerCandidate':True,'lossyCandidateHash':item['fault']['mutation']['afterHash']})
out={'at':r['finishedAt'],'source':str(base/'result.json'),'independentParser':'Python stdlib zipfile CRC + ElementTree; not production parser/model','actualAppGroups':len(r['checks']),'checks':checks,'status':'passed','boundary':'Verifies actual saved bytes/allowed cell and formula-cache changes, unchanged non-target package parts, every fault source stat and all12 private recovery envelopes against the unmodified legal Worker candidate. This does not claim uncompleted native copy groups, cryptographic signature validity or other platforms.'};(base/'independent-oracle.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':'passed','groups':len(r['checks']),'oracles':len(checks)}))
