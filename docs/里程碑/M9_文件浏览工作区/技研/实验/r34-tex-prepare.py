#!/usr/bin/env python3
"""Explicit preparation only; downloads pinned public artifacts to /tmp, never installs.
Compilation is separately performed offline by r34-tex-probe.py.
"""
import concurrent.futures, hashlib, json, os, pathlib, subprocess, sys, tarfile, zipfile

root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/private/tmp/m9-r34-tex').resolve()
assert root.is_relative_to(pathlib.Path('/private/tmp')), 'Use a dedicated /private/tmp experiment directory'
root.mkdir(parents=True,exist_ok=True)
commit='8c0126a9653239a2e6e0a5274af9b8510f643030'
archive_name='tectonic-0.17.0-aarch64-apple-darwin.tar.gz'
archive_hash='a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667'
archive_url='https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/'+archive_name

def download(url,target):
    if target.exists():return
    temporary=target.with_name(target.name+'.download')
    subprocess.run(['/usr/bin/curl','--fail','--silent','--show-error','--location','--max-time','60','--output',str(temporary),url],check=True)
    temporary.replace(target)

archive=root/archive_name
download(archive_url,archive)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==archive_hash
with tarfile.open(archive) as package:
    member=package.getmember('tectonic');assert member.isfile()
    (root/'tectonic').write_bytes(package.extractfile(member).read())
os.chmod(root/'tectonic',0o700)
download('https://api.github.com/repos/tectonic-typesetting/tectonic/git/trees/'+commit+'?recursive=1',root/'source-tree.json')
tree=json.loads((root/'source-tree.json').read_text());assert tree['sha']==commit and not tree.get('truncated')
items=[item for item in tree['tree'] if item['type']=='blob' and (item['path'].startswith('tests/assets/') or item['path']=='LICENSE')]
assets=root/'official-assets';assets.mkdir(exist_ok=True)
def fetch(item):
    name=pathlib.PurePosixPath(item['path']).name;target=assets/name
    url='https://raw.githubusercontent.com/tectonic-typesetting/tectonic/'+commit+'/'+item['path']
    download(url,target);data=target.read_bytes()
    blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    assert blob==item['sha'], item['path']
    return {'path':item['path'],'file':name,'bytes':len(data),'gitBlob':blob,'sha256':hashlib.sha256(data).hexdigest(),'url':url}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:files=sorted(pool.map(fetch,items),key=lambda value:value['file'])
manifest={'commit':commit,'files':files}
(root/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
digest=hashlib.sha256(''.join(f['file']+' '+f['sha256']+'\n' for f in files).encode()).hexdigest()
with zipfile.ZipFile(root/'minimal-plain-bundle.zip','w',zipfile.ZIP_DEFLATED) as bundle:
    for name,data in [(f['file'],(assets/f['file']).read_bytes()) for f in files]+[('SHA256SUM',(digest+'\n').encode())]:
        info=zipfile.ZipInfo(name,date_time=(2026,7,27,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100644<<16
        bundle.writestr(info,data)
result={'engineVersion':'0.17.0','releaseURL':'https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0','archiveURL':archive_url,'archiveSHA256':archive_hash,'binaryBytes':(root/'tectonic').stat().st_size,'sourceCommit':commit,'resourceCount':len(files),'resourceBytes':sum(f['bytes'] for f in files),'bundleBytes':(root/'minimal-plain-bundle.zip').stat().st_size,'bundleSHA256':hashlib.sha256((root/'minimal-plain-bundle.zip').read_bytes()).hexdigest(),'licenseURL':'https://github.com/tectonic-typesetting/tectonic/blob/'+commit+'/LICENSE'}
(root/'preparation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
