import json,os,time,subprocess,threading,http.server,socketserver,sqlite3,hashlib,signal
from pathlib import Path
r=Path(__file__).parent;home=r/"home";home.mkdir(mode=0o700,exist_ok=True)
events=[];lock=threading.Lock(); stop=threading.Event()
def save(n,v):
 p=r/n;p.write_text(json.dumps(v,ensure_ascii=False,indent=2));p.chmod(0o600)
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  family=self.path.split("/")[2] if self.path.startswith("/seed/") else None
  c=self.headers.get("Cookie","")
  facts={"at":time.time(),"path":self.path,"chromePresent":"m12_t083_chrome=T083_SYNTHETIC_CHROME" in c,"edgePresent":"m12_t083_edge=T083_SYNTHETIC_EDGE" in c}
  with lock: events.append(facts);save("server-events.json",events)
  self.send_response(200);self.send_header("Content-Type","text/html;charset=utf-8");self.send_header("Cache-Control","no-store")
  if family in ["chrome","edge"]:self.send_header("Set-Cookie",f"m12_t083_{family}=T083_SYNTHETIC_{family.upper()}; Max-Age=86400; Path=/; SameSite=Lax")
  self.end_headers();body="<html><head><title>T083 real-browser cookie import</title></head><body><h1>T083 isolated synthetic cookie check</h1><pre id='facts'>"+json.dumps(facts)+"</pre></body></html>";self.wfile.write(body.encode())
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);port=server.server_address[1]
threading.Thread(target=server.serve_forever,daemon=True).start()
save("server-ready.json",{"pid":os.getpid(),"port":port,"url":f"http://127.0.0.1:{port}/check","home":str(home)})
print(json.dumps({"serverReady":True,"pid":os.getpid(),"port":port}),flush=True)
try:
 for family,folder,binary in [("chrome","Google/Chrome",Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")),("edge","Microsoft Edge",r/"edge-expanded/MicrosoftEdge.pkg/Payload/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")]:
  if family=="edge":
   while not (r/"edge-app-ready.json").exists():
    if (r/"stop.request").exists():raise RuntimeError("Root stopped before Edge ready")
    time.sleep(.2)
   binary=Path(json.loads((r/"edge-app-ready.json").read_text())["executable"])
  profile=home/"Library/Application Support"/folder;profile.mkdir(parents=True,mode=0o700,exist_ok=True)
  env=os.environ.copy();env["HOME"]=str(home);env["TMPDIR"]=str(r/"browser-tmp");Path(env["TMPDIR"]).mkdir(mode=0o700,exist_ok=True)
  argv=[str(binary),"--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking","--disable-component-update","--disable-sync","--disable-extensions",f"--user-data-dir={profile}","--dump-dom","--virtual-time-budget=1500",f"http://127.0.0.1:{port}/seed/{family}"]
  with (r/(family+"-seed.stdout.private.log")).open("ab") as out,(r/(family+"-seed.stderr.private.log")).open("ab") as err:
   p=subprocess.Popen(argv,env=env,stdout=out,stderr=err);save(family+"-seed-process.json",{"pid":p.pid,"executable":str(binary),"argv":argv,"profile":str(profile),"home":str(home),"usesRealKeychain":True,"mockOrBasicPasswordStore":False})
   try:code=p.wait(timeout=1800)
   except subprocess.TimeoutExpired:p.terminate();p.wait(timeout=10);raise
  assert code==0,(family,code)
  candidates=[profile/"Default/Network/Cookies",profile/"Default/Cookies"];db=next(x for x in candidates if x.exists())
  con=sqlite3.connect(f"file:{db}?mode=ro",uri=True)
  rows=con.execute("select host_key,name,length(value),length(encrypted_value),hex(substr(encrypted_value,1,3)) from cookies").fetchall();con.close()
  selected=[x for x in rows if x[0]=="127.0.0.1" and x[1]=="m12_t083_"+family]
  assert len(selected)==1 and selected[0][2]==0 and selected[0][3]>3 and selected[0][4]=="763130",(family,selected)
  save(family+"-seed-result.json",{"exitCode":code,"signal":None,"database":str(db),"cookieMetadata":selected,"allRows":len(rows),"sha256":hashlib.file_digest(db.open("rb"),"sha256").hexdigest(),"realBrowserCreatedEncryptedCookie":True})
  print(json.dumps({"seeded":family,"encryptedCookie":True,"rows":len(rows)}),flush=True)
 save("both-browsers-seeded.json",{"at":time.time(),"home":str(home),"url":f"http://127.0.0.1:{port}/check"})
 while not (r/"stop.request").exists():time.sleep(.2)
finally:
 server.shutdown();server.server_close();save("server-cleanup.json",{"pid":os.getpid(),"port":port,"closed":True})
