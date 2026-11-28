import pathlib,json,subprocess,socket,re,urllib.parse
p=pathlib.Path('/private/tmp/willyou-m16-f36-run-Mrgxlc');r=json.loads((p/'result.json').read_text());assert r['pid']==8956 and r['exit']=={'pid':8956,'code':0,'signal':None};assert r['bundle']=='/private/tmp/willyou-m16-f36-resource-pkg-c12-profile-wyp0ofjp/WillYou.app';q=subprocess.run(['/bin/ps','-p','8956','-o','pid='],capture_output=True,text=True)
pids=set();paths=set();forgen=r['cpuDiagnostic']['before']['helpers']
for h in forgen:
 pids.update(h['pids'])
 for g in h['generations']:
  root=pathlib.Path(g['dir']);assert root.parent==pathlib.Path('/private/tmp') and root.name.startswith('wy-ab-');
  for name in g['socketNames']:
   assert pathlib.PurePath(name).name==name;paths.add(root/name)
observed=[]
for pid in sorted(pids):
 proc=subprocess.run(['/bin/ps','-p',str(pid),'-o','comm='],capture_output=True,text=True);same=proc.returncode==0 and proc.stdout.strip().startswith(r['bundle']+'/');observed.append({'recordedOwnHelperPid':pid,'stillOwnBundleImage':same})
ports=[('fixture and native model',urllib.parse.urlparse(r['fixture']['origin']).port),('own DevTools',int((pathlib.Path(r['userData'])/'DevToolsActivePort').read_text().splitlines()[0]))];log=(p/'electron.log').read_text();m=re.search(r'Debugger listening on ws://127\.0\.0\.1:(\d+)/[a-f0-9-]+',log);assert m;ports.append(('own Node inspector',int(m.group(1))));rows=[]
for role,port in ports:
 assert 1024<port<65536
 with socket.socket()as s:s.settimeout(.5);rows.append({'role':role,'port':port,'connectEx':s.connect_ex(('127.0.0.1',port))})
out={'scope':'only actual recorded own PIDs and known private endpoints/files after normal exit; not comprehensive helper process attribution','pid':8956,'appPidAbsent':q.returncode==1 or not q.stdout.strip(),'exit':r['exit'],'recordedHelperIdentityScope':observed,'allKnownHelperBundleImagesAbsent':not any(x['stillOwnBundleImage']for x in observed),'knownSocketPaths':len(paths),'allKnownHelperSocketsAbsent':not any(x.is_socket()for x in paths),'ports':rows};(p/'independent-cleanup.json').write_text(json.dumps(out,indent=2)+'\n');print(out)
