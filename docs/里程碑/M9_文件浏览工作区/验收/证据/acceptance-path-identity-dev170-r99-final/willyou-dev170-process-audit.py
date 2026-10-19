import pathlib,json,os,datetime
folders=['willyou-path-identity-A-u6pd1f','willyou-path-identity-A-PyK2sL','willyou-path-identity-A-Yg0QCw','willyou-path-identity-P-V2bEj3','willyou-path-identity-P-LEg4EL','willyou-path-drop-A-QhfhZB','willyou-path-failure-A-ozwo7P','willyou-path-drop-P-OheoNe','willyou-path-failure-P-D6Rtav']
rows=[];known=set()
for name in folders:
 p=pathlib.Path('/private/tmp')/name;r=json.load(open(p/'result.json'));pids={r['pid']}
 for f in list(p.glob('T*/sessions/*/identity.json'))+list(p.glob('T*/state.json')):
  x=json.load(open(f));pids.add(x['pid'])
 live=[]
 for pid in sorted(pids):
  try:os.kill(pid,0);live.append(pid)
  except ProcessLookupError:pass
 assert not live,(name,live);known.update(pids);rows.append({'folder':str(p),'pid':r['pid'],'pids':sorted(pids),'status':r['status'],'allAbsent':True})
x={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'knownOwnApps':len(rows),'knownOwnProcesses':len(known),'rows':rows};pathlib.Path('/private/tmp/willyou-dev170-process-audit.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x))
