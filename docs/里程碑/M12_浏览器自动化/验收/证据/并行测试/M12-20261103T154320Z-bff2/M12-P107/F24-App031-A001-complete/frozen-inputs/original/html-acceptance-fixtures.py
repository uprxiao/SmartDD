"""Original HTML fixtures. Only a caller-owned loopback trap URL is permitted."""
from pathlib import Path
import argparse,datetime,hashlib,html,json,struct,tempfile,urllib.parse,zlib
parser=argparse.ArgumentParser();parser.add_argument('--trap-url',required=True);args=parser.parse_args()
url=urllib.parse.urlsplit(args.trap_url);assert url.scheme=='http' and url.hostname=='127.0.0.1' and url.port and not url.username
root=Path(tempfile.mkdtemp(prefix='willyou-html-acceptance-',dir='/private/tmp'));project=root/'project';assets=project/'assets';assets.mkdir(parents=True)
outside=root/'outside-denied.js';outside.write_text("window.__OUTSIDE_SCRIPT_RAN='must-not-execute';\n")
(assets/'outside-link.js').symlink_to(outside)
(assets/'style.css').write_text('@import url("./nested.css"); h1{color:rgb(12,98,138)} #picture{border:3px solid rgb(210,40,30)}')
(assets/'nested.css').write_text('body{font-family:sans-serif;background:rgb(241,247,243);margin:14px}button{margin:6px;padding:8px}')
(assets/'classic.js').write_text("document.body.dataset.classic='CLASSIC_LOCAL_中文';")
(assets/'nested.mjs').write_text("export const message='MODULE_中文🙂';")
(assets/'module.mjs').write_text("import {message} from './nested.mjs'; document.body.dataset.module=message;")
(assets/'worker.js').write_text("postMessage('WORKER_EXECUTED');")
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,32,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([225,55,25,255])*64)*32))+chunk(b'IEND',b'')
(assets/'pixel.png').write_bytes(png)
(project/'next.html').write_text('<!doctype html><h1>MUST_NOT_NAVIGATE</h1>')
template=r'''<!doctype html><meta charset="UTF-8"><title>HTML isolated fixture</title><link rel="stylesheet" href="assets/style.css"><h1>HTML_F24_@NAME@_中文🙂</h1><img id="picture" src="assets/pixel.png"><p id="count">0</p><button id="count-button">点击计数</button><button id="local-nav">本地导航</button><button id="external-nav">外部导航</button><button id="popup">打开弹窗</button><iframe id="frame" src="next.html"></iframe><script src="assets/classic.js"></script><script src="assets/outside-link.js"></script><script type="module" src="assets/module.mjs"></script><script>
const trap=@TRAP@,d=document.body.dataset; window.__M9_DOC_EXECUTED='isolated';d.inline='INLINE_中文🙂';d.bridge=[typeof electronAPI,typeof require,typeof process,typeof Buffer,typeof ipcRenderer].join('|');d.parentSelf=String(parent===window);d.opener=String(opener===null);d.origin=window.origin;
fetch(trap+'/fetch').then(()=>d.fetch='executed',()=>d.fetch='blocked');
try{const x=new XMLHttpRequest();x.open('GET',trap+'/xhr');x.onload=()=>d.xhr='executed';x.onerror=()=>d.xhr='blocked';x.send()}catch(e){d.xhr='blocked'}
try{const s=new WebSocket(trap.replace('http:','ws:')+'/socket');s.onopen=()=>{d.socket='executed';s.close()};s.onerror=()=>d.socket='blocked'}catch(e){d.socket='blocked'}
try{const w=new Worker('assets/worker.js');w.onmessage=()=>{d.worker='executed';w.terminate()};w.onerror=()=>{d.worker='blocked';w.terminate()}}catch(e){d.worker='blocked'}
try{eval('window.__M9_EVAL_EXECUTED=true');d.eval='executed'}catch(e){d.eval='blocked'}
try{localStorage.setItem('m9-html','must-not-store');d.storage='executed'}catch(e){d.storage='blocked'}
addEventListener('message',e=>{if(e.data?.m9Probe){d.messageOrigin=e.origin;d.messageSourceSelf=String(e.source===window)}});parent.postMessage({m9Probe:true,origin:'app://trusted',channel:'files.open',args:['../outside-denied.js']},'*');
document.querySelector('#count-button').onclick=()=>document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);
document.querySelector('#local-nav').onclick=()=>{d.localNav='attempted';location.href='next.html'};
document.querySelector('#external-nav').onclick=()=>{d.externalNav='attempted';location.href=trap+'/navigation'};
document.querySelector('#popup').onclick=()=>{const w=open(trap+'/popup');d.popup=w?'executed':'blocked';if(w)w.close()};
</script><!-- END_HTML_FIXTURE -->'''
cases=[];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['plain.html','文档 space.htm']:
 source=template.replace('@NAME@',html.escape(name)).replace('@TRAP@',json.dumps(args.trap_url));p=project/name;p.write_text(source)
 cases.append({'name':name,'sha256':sha(p),'bytes':p.stat().st_size,'marker':'HTML_F24_'+name+'_中文🙂'})
files={str(p.relative_to(project)):{'sha256':sha(p),'bytes':p.stat().st_size} for p in project.rglob('*') if p.is_file() and not p.is_symlink()}
oracle={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectPath':str(project),'trapUrl':args.trap_url,'source':'Original local HTML/CSS/JS/PNG, controlled outside-root sentinel and symlink; no user data or third-party content.','cases':cases,'files':files,'outside':{'path':str(outside),'sha256':sha(outside)},'links':{'assets/outside-link.js':str(outside)}}
(root/'fixtures.json').write_text(json.dumps(oracle,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'projectPath':str(project),'manifest':str(root/'fixtures.json')}))
