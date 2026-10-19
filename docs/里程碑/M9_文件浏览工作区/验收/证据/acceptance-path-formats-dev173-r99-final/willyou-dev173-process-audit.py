import pathlib,json,os,datetime
folders=['willyou-path-formats-A-b1KrVh','willyou-path-formats-P-WzO6LW','willyou-path-drop-A-9T9jr3'];rows=[];known=set()
for name in folders:
 p=pathlib.Path('/private/tmp')/name;r=json.load(open(p/'result.json'));pids={r['pid']}
 for f in list(p.glob('T*/sessions/*/identity.json'))+list(p.glob('T*/state.json')):pids.add(json.load(open(f))['pid'])
 for pid in pids:
  try:os.kill(pid,0);raise AssertionError((name,pid,'still live'))
  except ProcessLookupError:pass
 known.update(pids);rows.append({'folder':str(p),'pid':r['pid'],'pids':sorted(pids),'status':r['status'],'allAbsent':True})
x={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'knownOwnApps':len(rows),'knownOwnProcesses':len(known),'rows':rows};pathlib.Path('/private/tmp/willyou-dev173-process-audit.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x))
