import http.server,threading,json,os,time
from pathlib import Path
r=Path(__file__).parent;b=r.parent;events=[]
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  c=self.headers.get("Cookie","");f={"at":time.time(),"path":self.path,"chromePresent":"m12_t083_chrome=T083_SYNTHETIC_CHROME" in c,"edgePresent":"m12_t083_edge=T083_SYNTHETIC_EDGE" in c};events.append(f);(r/"events.json").write_text(json.dumps(events));self.send_response(200);self.send_header("Content-Type","text/html;charset=utf-8");self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(("<html><head><title>T083 isolated cookie</title></head><body><h1>T083 synthetic cookie</h1><pre id=\"facts\">"+json.dumps(f)+"</pre></body></html>").encode())
s=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);port=s.server_address[1];v={"pid":os.getpid(),"port":port,"url":f"http://127.0.0.1:{port}/check","home":"/Users/liubu","resumeRoot":str(r)};(r/"server-ready.json").write_text(json.dumps(v));(b/"server-ready.json").write_text(json.dumps(v));threading.Thread(target=s.serve_forever,daemon=True).start();print(json.dumps({"ready":True,"pid":os.getpid(),"port":port}),flush=True)
try:
 while not (r/"stop.request").exists():time.sleep(.2)
finally:s.shutdown();s.server_close();(r/"cleanup.json").write_text(json.dumps({"pid":os.getpid(),"port":port,"closed":True}))
