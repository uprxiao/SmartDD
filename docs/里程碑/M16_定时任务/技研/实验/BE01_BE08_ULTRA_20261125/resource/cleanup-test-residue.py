#!/usr/bin/env python3
"""Record and clean only exact one-off fixture .version residue directories after App exit.
Separate from product cleanup result; normal raw close records retained."""
from pathlib import Path
import hashlib,json,os
roots=[Path('/private/tmp/willyou-f36-ultra-resource-w0qrBfb1'),Path('/private/tmp/willyou-f36-ultra-resource-6pxnnjka'),Path('/private/tmp/willyou-f36-ultra-resource-yn5rnje3')]
reports=[]
for root in roots:
 launch=json.loads((root/'launch.json').read_text());assert launch['processGroupMembersAfterExit']==[]
 rr=json.loads((root/'result.json').read_text());assert rr['final']['windows']==rr['final']['contents']==0
 events=[json.loads(x) for x in (root/'raw.jsonl').read_text().splitlines()]
 ids={c['pageId'] for c in rr['closed']}|{e['pageId'] for e in events if e.get('pageId')}
 for e in events:
  for p in (e.get('topology') or {}).get('registry') or []:ids.add(p['id'])
 data=root/'user-data';assert root.parent==Path('/private/tmp') and root.name.startswith('willyou-f36-ultra-resource-')
 dirs=[Path('/private/tmp')/('wy-ab-'+hashlib.sha256((str(data)+i).encode()).hexdigest()[:24]) for i in sorted(ids)]
 entries=[]
 for p in dirs:
  if not p.exists():entries.append({'directory':str(p),'exists':False});continue
  assert p.is_dir() and not p.is_symlink()
  files=list(p.iterdir());assert all(f.is_file() and not f.is_symlink() and f.name.endswith('.version') for f in files),str(p)
  rec={'directory':str(p),'exists':True,'files':[{'name':f.name,'size':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files]}
  entries.append(rec)
 homes=data/'browser/agent-browser-home';home_dirs=[p for p in homes.iterdir() if p.is_dir()] if homes.exists() else []
 homes_count={'directoryCount':len(home_dirs),'descendantCount':sum(len(list(p.rglob('*'))) for p in home_dirs),'fileBytes':sum(f.stat().st_size for p in home_dirs for f in p.rglob('*') if f.is_file())}
 # Store before-removal evidence in the private run directory.
 report={'root':str(root),'stage':'offline one-off fixture cleanup (not application normal cleanup)','allProcessGroupsGone':True,'expectedExactDirectories':len(dirs),'entriesBefore':entries,'helperHomesInsidePrivateData':homes_count}
 (root/'post-run-external-cleanup.json').write_text(json.dumps(report,indent=2)+'\n')
 for p in dirs:
  if p.exists():
   for f in list(p.iterdir()):
    assert f.is_file() and not f.is_symlink() and f.name.endswith('.version');f.unlink()
   p.rmdir()
 report['remainingExactExternalDirectories']=[str(p) for p in dirs if p.exists()];(root/'post-run-external-cleanup.json').write_text(json.dumps(report,indent=2)+'\n')
 assert not report['remainingExactExternalDirectories']
 reports.append(report)
print(json.dumps([{'root':r['root'],'directories':r['expectedExactDirectories'],'metadataFiles':sum(len(e.get('files',[])) for e in r['entriesBefore']),'helperHomes':r['helperHomesInsidePrivateData'],'remaining':r['remainingExactExternalDirectories']} for r in reports]))
