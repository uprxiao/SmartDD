#!/usr/bin/env python3
"""Build a pinned offline TeX candidate from the official v33 indexed bundle.

Network is used ONLY by this explicit preparation script. The separate compile
probe is sandboxed and offline. Nothing is installed globally or in the App.
The TeX Live database selects package file names; actual bytes always come from
the pinned Tectonic bundle, never from a mixed newer TeX Live runtime.
"""
import concurrent.futures, gzip, hashlib, json, lzma, pathlib, subprocess, sys, zipfile

ROOT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/private/tmp/m9-predev-resources').resolve()
assert ROOT.is_relative_to(pathlib.Path('/private/tmp'))
ROOT.mkdir(parents=True,exist_ok=True)
URL='https://data1b.fullyjustified.net/tlextras-2022.0r0.tar'
PACKAGES='latex latex-fonts latexconfig l3kernel l3packages l3backend unicode-data etex plain tex-ini-files xetexconfig cm lm amsfonts amsmath graphics graphics-cfg graphics-def tools fontspec xecjk ctex fandol xcolor hyperref kvsetkeys kvdefinekeys kvoptions ltxcmds pdftexcmds infwarerr intcalc bigintcalc bitset atbegshi atveryend gettitlestring letltxmacro rerunfilecheck stringenc auxhook hycolor geometry booktabs caption enumitem float fancyhdr url unicode-math lm-math iftex tex-gyre tex-gyre-math zapfding etoolbox adjustbox collectbox trimspaces varwidth grfext epstopdf-pkg listings fancyvrb upquote pdfescape refcount etexcmds xkeyval xunicode euenc zhnumber uniquecounter adobemapping'.split()
def sha(data):return hashlib.sha256(data).hexdigest()
def curl(url,path,start=None,end=None):
    args=['/usr/bin/curl','--fail','--silent','--show-error','--location','--retry','2','--max-time','180']
    if start is not None:args+=['--range',f'{start}-{end}']
    args+=['--output',str(path)+'.part',url]
    subprocess.run(args,check=True)
    part=pathlib.Path(str(path)+'.part')
    if start is not None:assert part.stat().st_size==end-start+1,(path,part.stat().st_size,end-start+1)
    part.replace(path)
if not (ROOT/'bundle.index').exists():
    curl(URL+'.index.gz',ROOT/'bundle.index.gz')
    (ROOT/'bundle.index').write_bytes(gzip.decompress((ROOT/'bundle.index.gz').read_bytes()))
if not (ROOT/'texlive.tlpdb').exists():
    curl('https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2022/tlnet-final/tlpkg/texlive.tlpdb.xz',ROOT/'texlive.tlpdb.xz')
    (ROOT/'texlive.tlpdb').write_bytes(lzma.decompress((ROOT/'texlive.tlpdb.xz').read_bytes()))
assert sha((ROOT/'bundle.index').read_bytes())=='0fb434b0fa5fdebea7f767ed9c31939c99a780d6f95cd3f540aae55910bb5697'
assert sha((ROOT/'texlive.tlpdb').read_bytes())=='0ec80acb5d263eb5daddb7f1a06253b2aceec4e7ea67a7e023de04ec82dfc8c6'
lock_path=pathlib.Path(__file__).resolve().parents[2]/'验收/证据/predev-resources/predev-tex-resource-manifest.json'
locked=json.loads(lock_path.read_text()) if lock_path.exists() else None
file_locks={r['name']:r['sha256'] for r in locked['files']} if locked else {}
db={x.splitlines()[0][5:]:x for x in (ROOT/'texlive.tlpdb').read_text().split('\n\n') if x.startswith('name ')}
PACKAGES+=sorted(n for n in db if n.startswith('hyphen-'))
entries={}
for line in (ROOT/'bundle.index').read_text().splitlines():
    name,offset,size=line.rsplit(' ',2);entries[name]=(int(offset),int(size))
selected={};package_records=[]
for package in PACKAGES:
    block=db[package];run=False;found=[];missing=[]
    for line in block.splitlines():
        if line.startswith('runfiles '):run=True;continue
        if not line.startswith(' '):run=False
        if run:
            source=line.strip().split()[0];name=pathlib.PurePosixPath(source).name
            if name in entries:selected.setdefault(name,[]).append({'package':package,'tlPath':source});found.append(name)
            else:missing.append(name)
    get=lambda prefix:next((l[len(prefix):] for l in block.splitlines() if l.startswith(prefix)),None)
    package_records.append({'name':package,'discoveryDatabaseRevision':get('revision '),'discoveryLicense':get('catalogue-license '),'discoveryVersion':get('catalogue-version '),'filesSelected':len(set(found)),'discoveryNamesAbsentInFixedBundle':missing})
for name in ['SVNREV','GITHASH','tectonic-format-latex.tex','tectonic-format-plain.tex','language.dat','language.def','language.us','pdftex.map','tex-text.tec','dvipdfmx.cfg','texglyphlist.txt','pdfglyphlist.txt','glyphlist.txt','kanjix.map','ckx.map']:
    if name in entries:selected.setdefault(name,[]).append({'package':'tectonic-v33-core','tlPath':None})
ranges=[]
for name in sorted(selected,key=lambda n:entries[n][0]):
    start,size=entries[name];end=start+size-1
    if ranges and start-ranges[-1]['end']<65536 and end-ranges[-1]['start']<12*1024*1024:
        ranges[-1]['end']=end;ranges[-1]['names'].append(name)
    else:ranges.append({'start':start,'end':end,'names':[name]})
chunks=ROOT/'ranges';chunks.mkdir(exist_ok=True)
assets=ROOT/'tex-assets';assets.mkdir(exist_ok=True)
head=(ROOT/'bundle-head.part').read_bytes() if (ROOT/'bundle-head.part').exists() else b''
print(json.dumps({'selectedFiles':len(selected),'ranges':len(ranges),'downloadBytes':sum(r['end']-r['start']+1 for r in ranges)}),flush=True)
def fetch(r):
    path=chunks/f"{r['start']}-{r['end']}.bin"
    if not path.exists():
        if r['end']<len(head):path.write_bytes(head[r['start']:r['end']+1])
        else:curl(URL,path,r['start'],r['end'])
    data=path.read_bytes();assert len(data)==r['end']-r['start']+1
    records=[]
    for name in r['names']:
        offset,size=entries[name];content=data[offset-r['start']:offset-r['start']+size]
        assert len(content)==size and '/' not in name and '\\' not in name
        if file_locks:assert sha(content)==file_locks[name], 'Upstream bytes changed: '+name
        (assets/name).write_bytes(content)
        records.append({'name':name,'offset':offset,'bytes':size,'sha256':sha(content),'packages':selected[name]})
    return records
records=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    for i,result in enumerate(pool.map(fetch,ranges)):
        records.extend(result)
        if i%20==0:print('completed ranges',i+1,flush=True)
records.sort(key=lambda r:r['name'])
identity=sha(''.join(r['name']+' '+r['sha256']+'\n' for r in records).encode())
(assets/'SHA256SUM').write_text(identity+'\n')
archive=ROOT/'willyou-tex-v33-candidate.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in [assets/n for n in sorted(list(selected)+['SHA256SUM'])]:
        info=zipfile.ZipInfo(p.name,date_time=(2026,10,17,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100644<<16
        z.writestr(info,p.read_bytes(),compresslevel=9)
result={'schema':'m9-predev-tex-resource-candidate-v1','sourceURL':URL,'sourceBundle':'tlextras-2022.0r0','sourceSVNRevision':(assets/'SVNREV').read_text().strip(),'sourceGitHash':(assets/'GITHASH').read_text().strip(),'indexSHA256':sha((ROOT/'bundle.index').read_bytes()),'discoveryDatabaseSHA256':sha((ROOT/'texlive.tlpdb').read_bytes()),'discoveryDatabaseNote':'TeX Live 2022 tlnet-final used for package name/path mapping only. Runtime bytes are all fixed v33 bundle; catalogue versions here are NOT runtime version claims. Embedded source headers and package source archives are authoritative.','files':records,'packages':package_records,'candidateIdentity':identity,'candidateArchiveSHA256':sha(archive.read_bytes()),'candidateArchiveBytes':archive.stat().st_size,'resourceBytes':sum(r['bytes'] for r in records),'fileCount':len(records)}
if locked:assert result['candidateArchiveSHA256']==locked['candidateArchiveSHA256'],'Candidate replay mismatch'
(ROOT/'predev-tex-resource-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['files','packages']}),flush=True)
