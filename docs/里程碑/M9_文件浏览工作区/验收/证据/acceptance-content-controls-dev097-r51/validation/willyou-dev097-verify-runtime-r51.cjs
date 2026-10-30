const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='/Users/hx/hx/hxWork/SmartDD',app='/private/tmp/willyou-m9-acceptance-batch-r51-build/mac-arm64/WillYou.app';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),records=[];
function walk(relative){for(const e of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const file=path.join(relative,e.name);if(e.isDirectory()){if(file!=='out/native')walk(file);}else if(/\.(?:js|css|html)$/.test(file)){const local=hash(fs.readFileSync(path.join(root,file))),packaged=hash(fs.readFileSync(path.join(app,'Contents/Resources/app.asar',file)));if(local!==packaged)throw Error('Build mismatch: '+file);records.push({file,sha256:local});}}}
walk('out');console.log(JSON.stringify({recordedAt:new Date().toISOString(),app,verified:records.length,files:records},null,2));
