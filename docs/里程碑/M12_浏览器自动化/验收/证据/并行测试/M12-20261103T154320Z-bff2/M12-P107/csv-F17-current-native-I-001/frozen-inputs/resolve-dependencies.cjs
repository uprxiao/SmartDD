// Resolution and file reads only. No resolved module is loaded.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const req=createRequire(path.join(__dirname,'inputs/package.json')),closure=require('./source-import-closure.json');
const specs=[...new Set(closure.edges.filter(e=>!e.resolved&&!e.isTypeOnly&&!e.spec.startsWith('node:')&&!e.spec.startsWith('.')).map(e=>e.spec))];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dependencies=specs.map(spec=>{const entry=spec==='@parcel/watcher'?path.join(__dirname,'current-watcher/index.js'):req.resolve(spec);let dir=path.dirname(entry);while(!fs.existsSync(path.join(dir,'package.json'))){const up=path.dirname(dir);if(up===dir)throw Error('package owner missing '+spec);dir=up;}const manifest=path.join(dir,'package.json'),pkg=JSON.parse(fs.readFileSync(manifest));return{specifier:spec,entry:fs.realpathSync(entry),entrySHA256:hash(entry),manifest:fs.realpathSync(manifest),manifestSHA256:hash(manifest),package:pkg.name,version:pkg.version};});
fs.writeFileSync(path.join(__dirname,'resolved-dependencies.json'),JSON.stringify({method:'createRequire.resolve only; no module loaded; selected entries and owner manifests pinned, full external transitive bytes not claimed',dependencies},null,2)+'\n');
console.log(JSON.stringify({resolved:dependencies.length,errors:0,nativeLoaded:0}));
