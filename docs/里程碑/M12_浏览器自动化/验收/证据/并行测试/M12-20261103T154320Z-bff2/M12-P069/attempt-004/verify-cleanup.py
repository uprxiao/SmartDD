from pathlib import Path
import sys,json,time,subprocess,hashlib,stat
sys.path.insert(0,str(Path(__file__).parent/'private-python'))
import psutil
root=Path(__file__).parent;raw=json.loads((root/'raw.json').read_text());prepared=json.loads((root/'prepared.json').read_text());births={x['pid']:x['createdAtEpochSeconds']for x in raw.get('sampler',{}).get('stopped',{}).get('knownIdentities',[])};rows=[]
for pid in raw['knownPids']:
 try:
  proc=psutil.Process(pid);birth=proc.create_time();same=pid not in births or births[pid]==birth
  rows.append({'pid':pid,'currentBirth':birth,'expectedBirth':births.get(pid),'sameOriginalIdentity':same,'gone':not same,'liveName':proc.name(),'boundary':'PID reuse is not an owned residue; no signals sent'})
 except psutil.NoSuchProcess:rows.append({'pid':pid,'gone':True})
 except psutil.AccessDenied:rows.append({'pid':pid,'gone':False,'error':'AccessDenied: identity unresolved'})
ports=[]
for port in raw['knownPorts']:
 p=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True);ports.append({'port':port,'status':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'closed':p.returncode==1 and not p.stdout.strip()})
helpers=[]
for page in raw['pages']:
 directory=Path('/private/tmp/wy-ab-'+hashlib.sha256((raw['userData']+page['pageId']).encode()).hexdigest()[:24]);remaining=[str(x)for x in directory.iterdir()if x.suffix in ['.pid','.sock','.stream']]if directory.exists()else[];helpers.append({'directory':str(directory),'remaining':remaining})
unix=[];tmp=root/'runtime-001/tmp'
if tmp.exists():
 for p in tmp.rglob('*'):
  if p.is_symlink():continue
  if p.is_socket()or p.name.startswith('willyou-cli-'):unix.append(str(p))
endpoints=sorted(set(raw.get('cliGatewayEndpoints',[]))|{e['cliEndpoint']for e in raw.get('agentEvents',[])if e.get('kind')=='receiver-ready'and e.get('cliEndpoint')});exact_gateway=[]
for endpoint in endpoints:
 if not(endpoint.startswith('/private/tmp/wy-cli-')and endpoint.endswith('/cli.sock')):raise ValueError('Unownedgatewaypathshape')
 for path in [Path(endpoint),Path(endpoint).parent]:
  try:
   info=path.lstat();exact_gateway.append({'path':str(path),'exists':True,'isSocket':stat.S_ISSOCK(info.st_mode),'isDirectory':stat.S_ISDIR(info.st_mode),'isSymlink':stat.S_ISLNK(info.st_mode)})
  except FileNotFoundError:exact_gateway.append({'path':str(path),'exists':False})
exact_gateways_gone=bool(endpoints)and all(not x['exists']for x in exact_gateway)
app_prefix=prepared['package']['app'].rstrip('/')+'/';orphans=[]
for proc in psutil.process_iter(['pid','exe'],ad_value=None):
 exe=proc.info.get('exe')
 if exe and exe.startswith(app_prefix):orphans.append(proc.info)
out={'atUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'group':'M12-P069','processes':rows,'ports':ports,'helpers':helpers,'remainingUnixGateway':unix,'exactGatewayPaths':exact_gateway,'exactGatewayEndpointCount':len(endpoints),'allExactGatewaysGone':exact_gateways_gone,'remainingExactAppBundleExecutables':orphans,'allOriginalProcessIdentitiesGone':all(x['gone']for x in rows),'allPortsClosed':all(x['closed']for x in ports),'allHelperRuntimeFilesGone':all(not x['remaining']for x in helpers),'allUnixGone':not unix and exact_gateways_gone,'allExactAppBundleExecutablesGone':not orphans,'boundary':'Read-only exact PID birth/port/private runtime checks; no kill/delete or unknown process cleanup.'};(root/'cleanup.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:out[k]for k in ['allOriginalProcessIdentitiesGone','allPortsClosed','allHelperRuntimeFilesGone','allUnixGone','allExactAppBundleExecutablesGone']}))
