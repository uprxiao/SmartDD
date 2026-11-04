const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const resources='/private/tmp/willyou-m12-s2-package-018/mac-arm64/WillYou.app/Contents/Resources',asar=path.join(resources,'app.asar');
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const main=fs.readFileSync(path.join(asar,'out/main/index.js'),'utf8');
const checks={ownedFrameRoute:main.includes('网页框架的所属会话尚未唯一确定'),deferredGuard:main.includes('原点击收尾结果未知'),exactInputCompletion:main.includes('原生鼠标输入仍未确认结束')};
if(Object.values(checks).some(x=>!x))throw Error('Expected tested main code missing from actual ASAR');
const skills=[];function walk(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,d.name);if(d.isDirectory())walk(q);else if(d.name==='SKILL.md'&&q.includes('browser'))skills.push({path:q,sha256:digest(q),dialogOpenedGuide:fs.readFileSync(q,'utf8').includes('dialogOpened: true')});}}
if(fs.existsSync(path.join(resources,'applications')))walk(path.join(resources,'applications'));
console.log(JSON.stringify({checks,mainSha256:digest(path.join(asar,'out/main/index.js')),preloads:fs.readdirSync(path.join(asar,'out/preload')),browserSkills:skills,nativeModules:['app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node','app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'].map(p=>({path:p,sha256:digest(path.join(resources,p))}))}));
