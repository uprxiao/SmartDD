import pathlib,json,subprocess,socket,urllib.parse,sys
p=pathlib.Path(sys.argv[1]);assert p.parent==pathlib.Path('/private/tmp') and p.name.startswith('willyou-m16-f36-run-');r=json.loads((p/'result.json').read_text());assert r['exit']['code']==0 and r['exit']['signal']is None;d=r['dynamic'];rows=[]
for pg in [d['anchorResource']]+[x['ownBefore']for x in d['cycles']]:
 for x in pg['resources']:
  old=x['identity'];assert old;pid=old['pid'];assert 'willyou-m16-f36-resource-pkg-c10-dynamic-kn71jsby/WillYou.app/' in old['row'];q=subprocess.run(['/bin/ps','-p',str(pid),'-o','pid=,ppid=,lstart=,comm='],capture_output=True,text=True);actual=q.stdout.strip() if q.returncode==0 else None;rows.append({'pageId':pg['pageId'],'pid':pid,'exactOldIdentityGone':actual!=old['row'],'oldHomeAbsent':not pathlib.Path(x['homePath']).exists(),'oldSocketAbsent':not pathlib.Path(x['socketPath']).exists()})
q=subprocess.run(['/bin/ps','-p',str(r['pid']),'-o','pid='],capture_output=True,text=True);ports=[{'role':'synthetic','port':urllib.parse.urlparse(r['fixture']['origin']).port}];path=pathlib.Path(r['userData'])/'DevToolsActivePort'
if path.exists():ports.append({'role':'own DevTools','port':int(path.read_text().splitlines()[0])})
for v in ports:
 assert 1024<v['port']<65536
 with socket.socket()as s:s.settimeout(.5);v['connectEx']=s.connect_ex(('127.0.0.1',v['port']))
res={'scope':'exact isolated historical dynamic helper identities and generation paths, no unknown PID interactions','exit':r['exit'],'appPidAbsent':q.returncode==1 or not q.stdout.strip(),'rows':rows,'ports':ports,'allExactOldGone':all(x['exactOldIdentityGone']for x in rows),'allDynamicRetiredPathsAbsent':all(x['oldHomeAbsent']and x['oldSocketAbsent']for x in rows[1:]),'anchorAfterExit':rows[0]};(p/'independent-dynamic-cleanup.json').write_text(json.dumps(res,indent=2)+'\n');print({k:v for k,v in res.items()if k!='rows'},'known identities',len(rows))
