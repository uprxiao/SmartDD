# Pure Python file parser. No subprocess, ctypes, dlopen, OS/Native/App or network.
from pathlib import Path
import struct,hashlib,json,math,plistlib,datetime
ROOT=Path('/private/tmp/willyou-m12-t017-native-payload-file-review-001')
INPUT=Path('/private/tmp/willyou-m12-t017-App025-AI-001/pending-equivalence.json')
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def cstr(b,at=0):
 assert 0<=at<=len(b)
 return b[at:].split(b'\0',1)[0].decode('utf-8',errors='strict')
def ver(n):return f'{n>>16}.{(n>>8)&255}.{n&255}'
def codesign(blob,signed):
 magic,length,count=struct.unpack_from('>III',blob);assert magic==0xfade0cc0 and 12+8*count<=length<=len(blob)
 slots=[]
 for i in range(count):
  typ,at=struct.unpack_from('>II',blob,12+8*i);m,l=struct.unpack_from('>II',blob,at);assert at+l<=length and l>=8;v=blob[at:at+l];r={'slot':typ,'magic':hex(m),'bytes':l,'sha256':sha(v)}
  if m==0xfade0c02:
   version,flags,hashOff,identOff,special,pages,limit=struct.unpack_from('>7I',v,8);size,kind,platform,shift=struct.unpack_from('>4B',v,36);assert kind==2 and size==32 and limit==len(signed);assert pages==math.ceil(limit/(1<<shift)) and hashOff+pages*size<=len(v)
   valid=all(v[hashOff+i*size:hashOff+(i+1)*size]==hashlib.sha256(signed[i*(1<<shift):min((i+1)*(1<<shift),limit)]).digest()for i in range(pages));team=struct.unpack_from('>I',v,48)[0]if version>=0x20200 else 0
   r.update({'version':hex(version),'flags':hex(flags),'adHocFlag':bool(flags&2),'runtimeFlag':bool(flags&0x10000),'linkerSignedFlag':bool(flags&0x20000),'identifier':cstr(v,identOff),'team':cstr(v,team)if team else None,'codeLimit':limit,'hashType':kind,'hashSize':size,'pageSize':1<<shift,'codePages':pages,'specialSlots':special,'allOwnCodePageHashesMatchFile':valid})
   assert valid
   if version>=0x20400:r['execSegment']=list(struct.unpack_from('>3Q',v,64))
   if version>=0x20500:r['runtimeVersion']=hex(struct.unpack_from('>I',v,88)[0])
  if m==0xfade7171:r['xmlEntitlements']=plistlib.loads(v[8:])
  slots.append(r)
 return {'superblobBytes':length,'allocatedBytes':len(blob),'allocatedSHA256':sha(blob),'paddingBytes':len(blob)-length,'paddingAllZero':not any(blob[length:]),'slots':slots,'XMLAndDEREntitlementSlots':[x for x in slots if x['slot']in [5,7]or x['magic']in ['0xfade7171','0xfade7172']],'trustVerification':'Self-consistent SHA256 CodeDirectory page hashes only; no Apple OS trust/signature-chain validation performed'}
def parse(path,expected):
 b=path.read_bytes();assert sha(b)==expected;assert b[:4]==bytes.fromhex('cffaedfe'),'These explicit targets must be thin little-endian Mach-O64; unknown/fat rejected'
 h=struct.unpack_from('<8I',b);assert h[0]==0xfeedfacf and h[1]==0x100000c;off=32;commands=[];segments=[];sections=[];blocks=[];dylibs=[];versions=[];sym=None;sig=None
 def block(kind,offset,size):
  assert offset+size<=len(b);blocks.append({'kind':kind,'offset':offset,'bytes':size,'sha256':sha(b[offset:offset+size])})
 for index in range(h[4]):
  cmd,size=struct.unpack_from('<II',b,off);assert size>=8 and off+size<=32+h[5];raw=b[off:off+size];row={'index':index,'command':hex(cmd),'offset':off,'bytes':size,'sha256':sha(raw)}
  if cmd==0x19:
   name=cstr(raw[8:24]);vm,vs,fo,fs,maxp,initp,ns,flags=struct.unpack_from('<4Q2i2I',raw,24);row['segment']=name;segment={'name':name,'vmaddr':vm,'vmsize':vs,'fileoff':fo,'filesize':fs,'maxprot':maxp,'initprot':initp,'sections':ns,'flags':flags,'commandOffset':off};segments.append(segment)
   assert fo+fs<=len(b)and size==72+80*ns
   for n in range(ns):
    z=72+80*n;sect=cstr(raw[z:z+16]);seg=cstr(raw[z+16:z+32]);addr,nbytes,fileoff,align,reloff,nreloc,flg,r1,r2,r3=struct.unpack_from('<2Q8I',raw,z+32);zero=(flg&255)in [1,0xc,0x12];assert zero or fileoff+nbytes<=len(b);sections.append({'segment':seg,'section':sect,'address':addr,'bytes':nbytes,'offset':fileoff,'align':align,'relocationOffset':reloff,'relocationCount':nreloc,'flags':flg,'reserved':[r1,r2,r3],'zeroFill':zero,'sha256':None if zero else sha(b[fileoff:fileoff+nbytes])})
  elif cmd==0x1d:
   d,n=struct.unpack_from('<2I',raw,8);assert sig is None and d+n==len(b);sig={'offset':d,'bytes':n,'commandOffset':off}
  elif cmd==2:
   so,n,st,ss=struct.unpack_from('<4I',raw,8);block('symbolTable',so,n*16);block('symbolStrings',st,ss);symbols=[];imports=[];exports=[]
   for nlist in range(n):
    ix,typ,sect,desc,val=struct.unpack_from('<IBBHQ',b,so+16*nlist);assert ix<ss;name=cstr(b[st:st+ss],ix);symbols.append([name,typ,sect,desc,val]);
    if not(typ&0xe0)and typ&1:
     if typ&0xe==0:imports.append(name)
     else:exports.append(name)
   sym={'symbols':n,'symbolsSHA256':sha(canonical(symbols)),'externalUndefinedNames':len(imports),'externalUndefinedNamesSHA256':sha(canonical(sorted(imports))),'externalDefinedNames':len(exports),'externalDefinedNamesSHA256':sha(canonical(sorted(exports)))}
  elif cmd in [0x22,0x80000022]:
   v=struct.unpack_from('<10I',raw,8)
   for n,name in enumerate(['rebase','bind','weakBind','lazyBind','dyldExportTrie']):block(name,*v[2*n:2*n+2])
  elif cmd in [0x1e,0x26,0x29,0x2b,0x2e,0x80000033,0x80000034]:block(hex(cmd),*struct.unpack_from('<2I',raw,8))
  elif cmd in [0xc,0xd,0x80000018,0x8000001f,0x20,0x80000023]:
   no,ts,cur,compat=struct.unpack_from('<4I',raw,8);dylibs.append({'command':hex(cmd),'name':cstr(raw,no),'timestamp':ts,'currentVersion':ver(cur),'compatibilityVersion':ver(compat)})
  elif cmd==0x32:
   platform,minos,sdk,ntools=struct.unpack_from('<4I',raw,8);versions.append({'kind':'LC_BUILD_VERSION','platform':platform,'minimumOS':ver(minos),'SDK':ver(sdk),'tools':[list(struct.unpack_from('<2I',raw,24+8*i))for i in range(ntools)]})
  elif cmd in [0x24,0x25,0x2f,0x30]:
   v,sdk=struct.unpack_from('<2I',raw,8);versions.append({'kind':hex(cmd),'minimumOS':ver(v),'SDK':ver(sdk)})
  elif cmd==0x2a:versions.append({'kind':'LC_SOURCE_VERSION','raw':str(struct.unpack_from('<Q',raw,8)[0])})
  commands.append(row);off+=size
 assert off==32+h[5]and sig;link=next(x for x in segments if x['name']=='__LINKEDIT');assert link['fileoff']+link['filesize']==len(b);assert link['vmsize']==math.ceil(link['filesize']/16384)*16384
 normalized=bytearray(b[:sig['offset']]);masks=[{'offset':link['commandOffset']+32,'bytes':8,'field':'__LINKEDIT.vmsize','justification':'16KiB rounded final LINKEDIT filesize including signature'},{'offset':link['commandOffset']+48,'bytes':8,'field':'__LINKEDIT.filesize','justification':'final file end minus LINKEDIT fileoff; only signature allocated size changes'},{'offset':sig['commandOffset']+12,'bytes':4,'field':'LC_CODE_SIGNATURE.datasize','justification':'exact allocated final signature range'}]
 for x in masks:normalized[x['offset']:x['offset']+x['bytes']]=bytes(x['bytes'])
 summary={'path':str(path),'sha256':sha(b),'bytes':len(b),'header':{'architecture':'arm64','cpuType':h[1],'cpuSubtype':h[2],'filetype':h[3],'commandCount':h[4],'commandBytes':h[5],'flags':hex(h[6]),'reserved':h[7]},'loadCommands':commands,'segments':segments,'sections':sections,'dyldDataBlocks':blocks,'dylibsAndVersions':dylibs,'buildVersions':versions,'symbols':sym,'signatureRange':sig,'signature':codesign(b[sig['offset']:],b[:sig['offset']]),'normalizedPreSignature':{'bytes':len(normalized),'sha256':sha(normalized),'onlyMasks':masks},'trailingOutsideSignatureBytes':0}
 return summary,b,bytes(normalized)
def compare(name,old,current):
 a,ab,an=parse(Path(old['path']),old['sha256']);b,bb,bn=parse(Path(current['path']),current['sha256']);assert a['signatureRange']['offset']==b['signatureRange']['offset'];limit=len(an);runs=[];start=None
 for at in range(0,limit,65536):
  x,y=ab[at:min(at+65536,limit)],bb[at:min(at+65536,limit)]
  if x==y:continue
  for i,(u,v)in enumerate(zip(x,y)):
   pos=at+i
   if u!=v:
    if start is None:start=pos
   elif start is not None:runs.append({'offset':start,'bytes':pos-start,'oldHex':ab[start:pos].hex(),'currentHex':bb[start:pos].hex()});start=None
  if start is not None:runs.append({'offset':start,'bytes':at+len(x)-start,'oldHex':ab[start:at+len(x)].hex(),'currentHex':bb[start:at+len(x)].hex()});start=None
 sectionEqual=a['sections']==b['sections'];symbolEqual=a['symbols']==b['symbols'];dyldEqual=a['dyldDataBlocks']==b['dyldDataBlocks'];versionEqual=a['buildVersions']==b['buildVersions']and a['dylibsAndVersions']==b['dylibsAndVersions'];headersEqual=a['header']==b['header'];otherCommands=[]
 for x,y in zip(a['loadCommands'],b['loadCommands']):
  if x['sha256']!=y['sha256']:otherCommands.append({'index':x['index'],'command':x['command'],'segment':x.get('segment'),'old':x,'current':y})
 normEqual=an==bn;entEqual=a['signature']['XMLAndDEREntitlementSlots']==b['signature']['XMLAndDEREntitlementSlots'];assert entEqual and not a['signature']['XMLAndDEREntitlementSlots'];r={'filePair':name,'old':a,'current':b,'comparison':{'architectureAndHeaderEqual':headersEqual,'allSectionsIncludingCodeAndDataAndZeroFillMetadataEqual':sectionEqual,'sectionCount':len(a['sections']),'symbolImportsExportsEqual':symbolEqual,'dyldBindExportChainedDataEqual':dyldEqual,'dylibImportsAndVersionMetadataEqual':versionEqual,'XMLAndDEREntitlementsEqualAndAbsent':entEqual,'nonSignaturePrefixEqualAfterThreeExplicitDerivedFieldMasks':normEqual,'changedLoadCommands':otherCommands,'actualPreSignatureByteDiffRuns':runs,'allocatedSignatureBytesOld':a['signatureRange']['bytes'],'allocatedSignatureBytesCurrent':b['signatureRange']['bytes'],'CodeDirectoryAndSigningIdentityNotEqual':a['signature']!=b['signature'],'strictSignedRuntimeEquivalenceClaimed':False,'unmaskedCodeDataPayloadEqual':normEqual and sectionEqual and symbolEqual and dyldEqual and versionEqual and headersEqual}}
 return r
if __name__=='__main__':
 pending=json.loads(INPUT.read_text());assert sha(INPUT.read_bytes())=='40a2ac67d463300529070653369e285af750cf159e7693f8e7aa323b9b437a69';results=[compare('ElectronFramework',pending['oldFramework'],pending['currentFramework']),compare('better_sqlite3.node',pending['oldSQLite'],pending['currentSQLite'])];record={'schema':'T017-readonly-MachO-payload-comparison-v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'inputManifest':{'path':str(INPUT),'sha256':sha(INPUT.read_bytes())},'results':results,'scope':'Only these two existing exact MachO files. Pure Python bytes/struct/plist/SHA256; no subprocess/otool/codesign/Native/App/OS/network/auth execution.','NativeAppOSModelExecution':False,'formalNewPasses':0};(ROOT/'comparison.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps([{'pair':x['filePair'],'codeDataPayloadEqual':x['comparison']['unmaskedCodeDataPayloadEqual'],'sections':x['comparison']['sectionCount'],'prefixHash':x['old']['normalizedPreSignature']['sha256'],'changedCommands':len(x['comparison']['changedLoadCommands']),'byteDiffRuns':x['comparison']['actualPreSignatureByteDiffRuns'],'entitlementsEqualAbsent':x['comparison']['XMLAndDEREntitlementsEqualAndAbsent']}for x in results],ensure_ascii=False))
