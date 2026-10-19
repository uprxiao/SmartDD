import pathlib,json,os,datetime
folders=['willyou-path-characters-A-Z6QSQI','willyou-path-characters-P-sjUhiR','willyou-path-characters-P-GVmpe4','willyou-path-characters-P-wMMVWc','willyou-path-characters-P-Xr51wY','willyou-path-characters-P-bZz0GH','willyou-path-characters-A-q9vtxW','willyou-path-drop-A-GPmxT5','willyou-path-drop-P-0of2kZ'];rows=[];known=set()
for name in folders:
 p=pathlib.Path('/private/tmp')/name;r=json.load(open(p/'result.json'));pids={r['pid']}
 for f in list(p.glob('T*/sessions/*/identity.json'))+list(p.glob('T*/state.json')):pids.add(json.load(open(f))['pid'])
 for pid in pids:
  try:os.kill(pid,0);raise AssertionError((name,pid,'still live'))
  except ProcessLookupError:pass
 known.update(pids);rows.append({'folder':str(p),'pid':r['pid'],'pids':sorted(pids),'status':r['status'],'allAbsent':True})
x={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'knownOwnApps':len(rows),'knownOwnProcesses':len(known),'rows':rows};pathlib.Path('/private/tmp/willyou-dev172-process-audit.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x))
