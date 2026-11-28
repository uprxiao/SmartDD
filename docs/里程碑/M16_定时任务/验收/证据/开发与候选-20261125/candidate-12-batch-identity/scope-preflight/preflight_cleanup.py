import pathlib,json,re,socket,urllib.parse,psutil
p=pathlib.Path('/private/tmp/willyou-m16-f36-run-URoc7F');c=pathlib.Path('/private/tmp/willyou-m16-f36-cohort-DwFF2J');r=json.loads((p/'result.json').read_text());assert r['exit']=={'pid':14028,'code':0,'signal':None};controller=json.loads((c/'driver-exit.json').read_text());assert controller['wrapperPid']==14024 and controller['driverPid']==14026 and controller['terminationStatus']==0 and not controller['stopSent'];records=[json.loads(s)for s in (p/'scope-attempts.jsonl').read_text().splitlines()];known={}
for x in records:
 for a in x.get('attempts',[]):
  for n in a.get('nodes',[]):known[(n['pid'],n['birth'])]={'pid':n['pid'],'birth':n['birth'],'role':n['role'],'pathClass':n['pathClass']}
rows=[]
for k,n in sorted(known.items()):
 sec,usec=map(int,n['birth'].split(':'))
 try:actual=psutil.Process(n['pid']).create_time();state='same-recorded-birth-still-present' if abs(actual-(sec+usec/1e6))<.0001 else 'gone-or-reused'
 except psutil.NoSuchProcess:state='gone'
 except psutil.AccessDenied:state='read-denied'
 rows.append({**n,'state':state})
paths=set()
for h in r['resource']['preflight']['helpers']:
 for g in h['generations']:
  root=pathlib.Path(g['dir']);assert root.parent==pathlib.Path('/private/tmp') and root.name.startswith('wy-ab-');
  for n in g['socketNames']:
   assert pathlib.PurePath(n).name==n;paths.add(root/n)
ports=[('own fixture and synthetic gateway',urllib.parse.urlparse(r['fixture']['origin']).port),('own DevTools',int((pathlib.Path(r['userData'])/'DevToolsActivePort').read_text().splitlines()[0]))];m=re.search(r'Debugger listening on ws://127\.0\.0\.1:(\d+)/[a-f0-9-]+',(p/'electron.log').read_text());assert m;ports.append(('own Node inspector',int(m.group(1))));endpoints=[]
for role,port in ports:
 with socket.socket()as s:s.settimeout(.5);endpoints.append({'role':role,'port':port,'connectEx':s.connect_ex(('127.0.0.1',port))})
o={'scope':'exact known own preflight graph births only; actual missing two cohort members never guessed','allKnownBirthsAbsent':all(n['state']in ('gone','gone-or-reused')for n in rows),'knownRows':rows,'knownSocketPaths':len(paths),'allKnownHelperSocketsAbsent':not any(x.is_socket()for x in paths),'ports':endpoints,'allKnownPortsClosed':all(x['connectEx']!=0 for x in endpoints),'AppExit':r['exit'],'driverExit':controller};(p/'independent-cleanup.json').write_text(json.dumps(o,indent=2)+'\n');print('known births',len(rows),'all absent',o['allKnownBirthsAbsent'],'socket paths',len(paths),'all absent',o['allKnownHelperSocketsAbsent'],'ports',endpoints)
