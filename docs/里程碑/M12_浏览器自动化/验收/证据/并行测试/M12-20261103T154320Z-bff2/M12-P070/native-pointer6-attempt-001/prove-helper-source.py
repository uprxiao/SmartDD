from pathlib import Path
import json,tarfile,hashlib,subprocess
root=Path('/private/tmp/willyou-m12-p070-js-dialog-native-005-pointer6-001');build=Path('/Users/liubu/hx/4.uprxiao/SmartDD/out/agent-browser-build/2c7991c9eccca1c9db6eee1a26a713414778de5a-979bc1d82b6aae6f');actual=build/'agent-browser-2c7991c9eccca1c9db6eee1a26a713414778de5a';archive=build/'upstream.tar.gz';patch=Path('/private/tmp/willyou-m12-p070-source-011/source/resources/agent-browser/patches/willyou-s3.patch');dst=root/'helper-source-reconstructed';dst.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest();assert sha(archive.read_bytes())=='8fb43156f2a3889d563292b1ccd1fcfba677c32147cbacb542952fd964eb6aa2';assert sha(patch.read_bytes())=='979bc1d82b6aae6f5b81154df247642df44dbb5b17e00a7731583ae67266431f'
with tarfile.open(archive) as t:
 for m in t:
  if not m.isfile():continue
  rel=Path(*Path(m.name).parts[1:])
  if not rel.parts or rel.parts[0]!='cli':continue
  assert '..' not in rel.parts
  p=dst/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(m).read())
proc=subprocess.run(['/usr/bin/patch','-p1','-F0','--batch','-i',str(patch)],cwd=dst,capture_output=True,text=True);(root/'helper-source-apply.log').write_text(proc.stdout+proc.stderr);assert proc.returncode==0
rows=[]
for p in sorted(dst.rglob('*')):
 if not p.is_file():continue
 rel=p.relative_to(dst);b=p.read_bytes();assert b==(actual/rel).read_bytes(),str(rel);rows.append({'path':str(Path('helper-source-reconstructed')/rel),'sha256':sha(b),'bytes':len(b)})
meta=json.loads((root/'resources/agent-browser/SOURCE.json').read_text());assert sha((dst/'cli/Cargo.lock').read_bytes())==meta['build']['cargoLockSha256'];(root/'actual-helper-SOURCE.json').write_bytes((root/'resources/agent-browser/SOURCE.json').read_bytes());(root/'actual-helper-patch.patch').write_bytes(patch.read_bytes());proof={'allFilesExactlyReconstructed':True,'fuzz':0,'archiveSha256':sha(archive.read_bytes()),'patchSha256':sha(patch.read_bytes()),'declaredActualBinarySha256':meta['files'][0]['sha256'],'actualRuntimeSourceSha256':sha((root/'actual-helper-SOURCE.json').read_bytes()),'immutableSourceRoot':str(actual),'files':rows,'nativeStarted':False,'scope':'Static fullCLI source reconstruction only; currentbuildtarget is not used as binaryidentity'};(root/'helper-source-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'files':len(rows),'allByteExact':True,'nativeStarted':False}))
