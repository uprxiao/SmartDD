from pathlib import Path
import hashlib, json, re, shutil, tarfile, datetime, difflib

ROOT=Path('/private/tmp/willyou-m12-t065-executor-001/attempt-005')
PARENT=ROOT.parent
WORK=Path('/Users/liubu/hx/4.uprxiao/SmartDD/out/agent-browser-build')
COMMIT='2c7991c9eccca1c9db6eee1a26a713414778de5a'
REVISIONS={'.2':('bfccebf4f5c96cdd','attempt-002'),'.3':('0b6a37ff3c9aa5da','attempt-003'),'.4':('eb00b4c21c649a62','attempt-004')}
sha=lambda value:hashlib.sha256(value).hexdigest()
dump=lambda name,value:(ROOT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()

def patch_files(patch):
    lines=patch.decode().splitlines(keepends=True); out={};i=0
    while i<len(lines):
        if not lines[i].startswith('--- a/'):i+=1;continue
        path=lines[i][6:].strip();assert lines[i+1].strip()=='+++ b/'+path;i+=2;hunks=[]
        while i<len(lines)and not lines[i].startswith('--- a/'):
            m=re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@',lines[i])
            if not m:i+=1;continue
            start,old_count,new_start,new_count=[int(x)if x is not None else 1 for x in m.groups()];i+=1;body=[]
            while i<len(lines)and not lines[i].startswith('@@ ')and not lines[i].startswith('--- a/'):
                if lines[i].startswith((' ','+','-','\\')):body.append(lines[i]);i+=1
                else:break
            hunks.append((start,old_count,new_start,new_count,body))
        out[path]=hunks
    return out

def apply_hunks(original,hunks):
    lines=original.decode().splitlines(keepends=True);out=[];cursor=0
    for start,old_count,new_start,new_count,body in hunks:
        at=max(0,start-1);assert at>=cursor;out+=lines[cursor:at];cursor=at;old_seen=new_seen=0
        for row in body:
            prefix=row[0]
            if prefix=='\\':continue
            if prefix in ' -':assert lines[cursor]==row[1:],(start,cursor,lines[cursor],row);cursor+=1;old_seen+=1
            if prefix in ' +':out.append(row[1:]);new_seen+=1
        assert(old_seen,new_seen)==(old_count,new_count),((old_seen,new_seen),(old_count,new_count))
    out+=lines[cursor:];return ''.join(out).encode()

# Lexical masking retains byte/line offsets. Rust strings, raw strings, chars,
# line comments and nested block comments cannot contribute structural braces.
def mask_rust(data):
    text=data.decode();chars=list(text);i=0;n=len(text)
    def blank(a,b):
        for j in range(a,b):
            if chars[j]!='\n':chars[j]=' '
    while i<n:
        if text.startswith('//',i):
            end=text.find('\n',i);end=n if end<0 else end;blank(i,end);i=end;continue
        if text.startswith('/*',i):
            j=i+2;depth=1
            while j<n and depth:
                if text.startswith('/*',j):depth+=1;j+=2
                elif text.startswith('*/',j):depth-=1;j+=2
                else:j+=1
            assert depth==0;blank(i,j);i=j;continue
        m=re.match(r'(?:b|c)?r(#{0,32})"',text[i:])
        if m:
            ending='"'+m.group(1);end=text.find(ending,i+len(m.group(0)));assert end>=0;end+=len(ending);blank(i,end);i=end;continue
        if text[i]=='"':
            j=i+1
            while j<n:
                if text[j]=='\\':j+=2
                elif text[j]=='"':j+=1;break
                else:j+=1
            blank(i,j);i=j;continue
        if text[i]=="'":
            m=re.match(r"'(?:[^'\\\n]|\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.))'",text[i:])
            if m:end=i+len(m.group(0));blank(i,end);i=end;continue
        i+=1
    return ''.join(chars)

def functions(data):
    text=data.decode();masked=mask_rust(data);rows=[]
    pattern=r'(?m)^[ \t]*(?:(?:pub(?:\([^)]*\))?|unsafe|async|const|extern\s+"[^"]*")\s+)*fn\s+([A-Za-z_][A-Za-z_0-9]*)\b'
    for m in re.finditer(pattern,masked):
        start=m.start();opening=masked.find('{',m.end());semicolon=masked.find(';',m.end())
        if opening<0 or 0<=semicolon<opening:continue
        depth=1;end=opening+1
        while end<len(masked)and depth:
            if masked[end]=='{':depth+=1
            elif masked[end]=='}':depth-=1
            end+=1
        assert depth==0,m.group(1)
        b=text[start:end].encode();rows.append({'name':m.group(1),'startLine':text.count('\n',0,start)+1,'endLine':text.count('\n',0,end)+1,'start':start,'end':end,'bytes':len(b),'sha256':sha(b),'body':b})
    return rows

def split_semantic(data):
    f=next(f for f in functions(data)if f['name']=='handle_semantic_locator');text=f['body'].decode();start=text.index('    let query = match strategy {');after=text.index('    let result: super::cdp::types::EvaluateResult',start);label=text.index('        "label" => {',start);opening=text.index('{',label);masked=mask_rust(text.encode());depth=1;end=opening+1
    while depth:
        if masked[end]=='{':depth+=1
        elif masked[end]=='}':depth-=1
        end+=1
    prefix=text[:text.index('    let match_fn = if exact {')]
    return {'semantic_prefix':prefix.encode(),'semantic_label_branch':text[label:end].encode(),'semantic_suffix':text[after:].encode(),'semantic_match_fn_unused_for_label':text[len(prefix):start].encode()}

archive=WORK/(COMMIT+'-eb00b4c21c649a62')/'upstream.tar.gz';archive_bytes=archive.read_bytes();upstream={}
with tarfile.open(archive,'r:gz')as tar:
    for item in tar.getmembers():
        marker='/cli/'
        if item.isfile()and marker in item.name:upstream['cli/'+item.name.split(marker,1)[1]]=tar.extractfile(item).read()
shutil.copyfile(archive,ROOT/'upstream.tar.gz')
versions={};provenance=[]
for revision,(suffix,attempt)in REVISIONS.items():
    work=WORK/(COMMIT+'-'+suffix);source=work/('agent-browser-'+COMMIT);prior=PARENT/attempt;metadata=json.loads((prior/'resources/agent-browser/SOURCE.json').read_bytes());patch=(prior/'source/resources/agent-browser/patches/willyou-s3.patch').read_bytes();assert sha(archive_bytes)==metadata['upstream']['archiveSha256'];assert sha(patch)==metadata['patch']['sha256'];assert work.joinpath('patched-input.sha256').read_text().strip()==sha(archive_bytes+patch)
    expected=dict(upstream)
    for path,hunks in patch_files(patch).items():
        assert path in expected,path;expected[path]=apply_hunks(expected[path],hunks)
    actual={str(path.relative_to(source)):path.read_bytes()for path in(source/'cli').rglob('*')if path.is_file()};assert set(actual)==set(expected),(set(actual)-set(expected),set(expected)-set(actual))
    for path,value in actual.items():assert value==expected[path],(revision,path)
    snap=ROOT/'sources'/revision.removeprefix('.')
    for path,value in actual.items():dest=snap/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(value)
    (snap/'SOURCE.json').write_text(json.dumps(metadata,indent=2)+'\n');(snap/'willyou-s3.patch').write_bytes(patch);(snap/'patched-input.sha256').write_text(work.joinpath('patched-input.sha256').read_text())
    built=work/'target/aarch64-apple-darwin/ci/agent-browser';pinned=prior/'resources/agent-browser/arm64/agent-browser';pinned_sha=sha(pinned.read_bytes());assert pinned_sha==next(x['sha256']for x in metadata['files']if x['arch']=='arm64')
    row={'revision':revision,'immutableSourceRoot':str(source),'files':len(actual),'allFilesExactlyReconstructedFromUpstreamPlusPatch':True,'archiveSha256':sha(archive_bytes),'patchSha256':sha(patch),'patchedInputStamp':sha(archive_bytes+patch),'declaredPinnedBinarySha256':pinned_sha,'currentBuildTargetSha256':sha(built.read_bytes()),'buildTargetMatchesPinnedBinary':sha(built.read_bytes())==pinned_sha,'sourceFiles':[{'path':path,'sha256':sha(value),'bytes':len(value)}for path,value in sorted(actual.items())]};provenance.append(row);versions[revision]=actual
dump('source-provenance.json',{'at':now(),'boundary':'No helper execution or compilation. Full CLI sources reconstructed byte-exactly from hashed upstream archive and archived patch; current .2 build target differs from actual tested frozen binary and is not claimed to be it.','versions':provenance})

all_paths=sorted(set().union(*(v.keys()for v in versions.values())));file_comparisons=[]
for path in all_paths:
    hashes={r:sha(v[path])if path in v else None for r,v in versions.items()};file_comparisons.append({'path':path,'sha256':hashes,'allEqual':len(set(hashes.values()))==1})
dump('file-comparisons.json',{'at':now(),'comparisons':file_comparisons,'changedFiles':[x['path']for x in file_comparisons if not x['allEqual']]})

function_comparisons=[];function_maps={}
for path in['cli/src/native/actions.rs','cli/src/native/interaction.rs','cli/src/commands.rs']:
    maps={r:{f['name']:f for f in functions(v[path])}for r,v in versions.items()};function_maps[path]=maps
    for name in sorted(set().union(*(m.keys()for m in maps.values()))):
        rows={r:m.get(name)for r,m in maps.items()};hashes={r:f['sha256']if f else None for r,f in rows.items()};function_comparisons.append({'path':path,'function':name,'sha256':hashes,'allEqual':len(set(hashes.values()))==1,'ranges':{r:{k:f[k]for k in['startLine','endLine','bytes']}if f else None for r,f in rows.items()}})
dump('function-comparisons.json',{'at':now(),'method':'Rust-aware string/comment masking and balanced structural braces; exact original function bytes, no whitespace/comment normalization. Full originals are retained. Duplicate names outside relevant unique functions are not used for route proof.','comparisons':function_comparisons,'changedFunctions':[{'path':x['path'],'function':x['function'],'sha256':x['sha256']}for x in function_comparisons if not x['allEqual']]})

fragments={r:split_semantic(v['cli/src/native/actions.rs'])for r,v in versions.items()};fragment_rows=[]
for name in fragments['.4']:
    hashes={r:sha(m[name])for r,m in fragments.items()};fragment_rows.append({'fragment':name,'sha256':hashes,'allEqual':len(set(hashes.values()))==1})
    for r,m in fragments.items():dest=ROOT/'fragments'/r.removeprefix('.')/(name+'.rs');dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(m[name])
assert all(x['allEqual']for x in fragment_rows if x['fragment']!='semantic_match_fn_unused_for_label')
dump('semantic-label-path.json',{'at':now(),'fragments':fragment_rows,'reasonUnusedMatchFnIsExcluded':'match_fn is a pure formatted string created before match; label branch does not reference it. Its changed textOf expression is interpolated only by the default text branch, so its different literal bytes do not alter label query or transport/error/subaction suffix. Full function sources retained for review.'})

print(json.dumps({'sourceFilesPerVersion':[x['files']for x in provenance],'changedFiles':[x['path']for x in file_comparisons if not x['allEqual']],'changedFunctions':[x['function']for x in function_comparisons if not x['allEqual']],'labelFragments':fragment_rows,'binaryTargetMatches':[{'revision':x['revision'],'matches':x['buildTargetMatchesPinnedBinary']}for x in provenance]},ensure_ascii=False))
