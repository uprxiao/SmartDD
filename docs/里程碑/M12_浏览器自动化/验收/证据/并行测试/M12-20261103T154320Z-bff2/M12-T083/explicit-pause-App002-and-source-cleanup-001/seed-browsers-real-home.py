import json,os,time,subprocess,threading,http.server,sqlite3,hashlib,shutil,stat,uuid
from pathlib import Path
r=Path(__file__).parent
home=Path.home()
assert home==Path('/Users/liubu')
events=[]
def save(n,v):
 p=r/n;p.write_text(json.dumps(v,ensure_ascii=False,indent=2));p.chmod(0o600)
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  family=self.path.split('/')[2] if self.path.startswith('/seed/') else None
  c=self.headers.get('Cookie','')
  fact={'at':time.time(),'path':self.path,'chromePresent':'m12_t083_chrome=T083_SYNTHETIC_CHROME' in c,'edgePresent':'m12_t083_edge=T083_SYNTHETIC_EDGE' in c}
  events.append(fact);save('server-events.json',events)
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.send_header('Cache-Control','no-store')
  if family in ['chrome','edge']:self.send_header('Set-Cookie',f'm12_t083_{family}=T083_SYNTHETIC_{family.upper()}; Max-Age=86400; Path=/; SameSite=Lax')
  self.end_headers();self.wfile.write(('<html><head><title>T083 isolated cookie</title></head><body><h1>T083 synthetic cookie</h1><pre id="facts">'+json.dumps(fact)+'</pre></body></html>').encode())
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);port=server.server_address[1]
threading.Thread(target=server.serve_forever,daemon=True).start()
save('server-ready.json',{'pid':os.getpid(),'port':port,'url':f'http://127.0.0.1:{port}/check','home':str(home)})
print(json.dumps({'serverReady':True,'pid':os.getpid(),'port':port,'realKeychainHOME':True}),flush=True)
locations={'home':str(home),'profiles':{},'userDataIsolation':True,'dailyProfilesReadOrModified':False,'localStateModified':False}
children=[]
try:
 for family,folder,binary in [('chrome','Google/Chrome',Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')),('edge','Microsoft Edge',Path(json.loads((r/'edge-app-ready.json').read_text())['executable']))]:
  source=r/'real-home-seed-attempt004'/family;source.mkdir(parents=True,mode=0o700)
  name='Profile '+str(int(time.time()*1000))
  env=os.environ.copy();assert env.get('HOME')==str(home);env['TMPDIR']=str(r/'browser-tmp');Path(env['TMPDIR']).mkdir(mode=0o700,exist_ok=True)
  argv=[str(binary),'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--remote-debugging-port=0',f'--user-data-dir={source}',f'--profile-directory={name}','about:blank']
  with (r/(family+'-real-home.stdout.private.log')).open('xb') as out,(r/(family+'-real-home.stderr.private.log')).open('xb') as err:
   child=subprocess.Popen(argv,env=env,stdout=out,stderr=err);children.append(child)
   save(family+'-seed-process.json',{'pid':child.pid,'executable':str(binary),'privateUserData':str(source),'profileDirectory':name,'usesRealUserHOME':True,'mockOrBasicPasswordStore':False})
   helper=subprocess.Popen(['/Users/liubu/.hermes/node/bin/node',str(r/'seed-cookie-cdp.mjs'),str(source),f'http://127.0.0.1:{port}/',family,str(r/(family+'-real-cdp-result.json'))],env={**env,'NODE_COMPILE_CACHE':str(r/'seed-node-cache')},stdout=out,stderr=err);children.append(helper)
   code=helper.wait(timeout=1900);assert code==0,(family,'CDP helper',code)
   exitcode=child.wait(timeout=30);assert exitcode==0,(family,'normal browser exit',exitcode)
  profile=source/name
  db=next(q for q in [profile/'Network/Cookies',profile/'Cookies'] if q.exists())
  con=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
  rows=con.execute('select host_key,name,length(value),length(encrypted_value),hex(substr(encrypted_value,1,3)) from cookies').fetchall();con.close()
  selected=[q for q in rows if q[0]=='127.0.0.1' and q[1]=='m12_t083_'+family]
  assert len(selected)==1 and selected[0][2]==0 and selected[0][3]>3 and selected[0][4]=='763130',(family,selected)
  for directory,dirs,files in os.walk(profile):
   for n in dirs+files:assert not (Path(directory)/n).is_symlink(),'No profile symlink staging'
  parent=home/'Library/Application Support'/folder
  existed=parent.exists();parent.mkdir(parents=True,exist_ok=True)
  destination=parent/name;assert not destination.exists()
  shutil.copytree(profile,destination,symlinks=False)
  marker={'run':'M12-T083-real-browsers-001-attempt004','nonce':uuid.uuid4().hex,'source':str(profile)}
  (destination/'.willyou-t083-owned.json').write_text(json.dumps(marker));destination.chmod(0o700)
  staged=destination/db.relative_to(profile);digest=hashlib.file_digest(db.open('rb'),'sha256').hexdigest();assert hashlib.file_digest(staged.open('rb'),'sha256').hexdigest()==digest
  ds=destination.stat();locations['profiles'][family]={'profileDirectory':name,'directory':str(destination),'cookieDatabase':str(staged),'sha256':digest,'device':ds.st_dev,'inode':ds.st_ino,'markerNonce':marker['nonce'],'parentCreatedByThisRun':not existed,'copiedFromRealBrowserPrivateProfile':True}
  save('source-profile-locations.json',locations)
  save(family+'-seed-result.json',{'exitCode':exitcode,'signal':None,'database':str(staged),'cookieMetadata':selected,'allRows':len(rows),'sha256':digest,'realBrowserCreatedEncryptedCookie':True,'normalCDPBrowserClose':True,'usesRealUserHOME':True})
  print(json.dumps({'seeded':family,'encryptedCookieOnDisk':True,'sourceCopiedToOwnExclusiveProfile':True}),flush=True)
 save('both-browsers-seeded.json',{'at':time.time(),'home':str(home),'url':f'http://127.0.0.1:{port}/check','sourceLocations':str(r/'source-profile-locations.json')})
 while not (r/'stop.request').exists():time.sleep(.2)
finally:
 for child in reversed(children):
  if child.poll() is None:
   child.terminate()
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:child.kill();child.wait(timeout=10)
 server.shutdown();server.server_close();save('server-cleanup.json',{'pid':os.getpid(),'port':port,'closed':True})
