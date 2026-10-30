'use strict';
// Target-Linux read-core candidate; the public non-darwin guard remains intact.
// Source access is exclusively through the sibling C Node-API authority. No
// path-based fs API, caller-supplied fd or source-file writable operation.
// Recovery bootstrap delegates its two fixed private directories to native FDs.
const { createHash, randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');
const ASSET = 256 * 1024 * 1024, TEXT = 20 * 1024 * 1024, CHUNK = 1024 * 1024;
const INPUT = 1024 * 1024, CHECKPOINT_INPUT = Math.ceil(41*1024*1024/3)*4+INPUT, OUTPUT = 64 * 1024 * 1024;
const CODES = new Set(['INVALID_INPUT','UNTRUSTED','UNSUPPORTED','STALE_ROOT','CHANGED','MISSING','NOT_REGULAR','PERMISSION','TOO_LARGE','INTERNAL_OBJECT','IO','CONFLICT','IDEMPOTENCY','QUOTA']);
function failure(code, message) { const error = new Error(message); error.code = code; throw error; }
function object(value, keys, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value,key))) failure('INVALID_INPUT','Unexpected request object fields');
  return value;
}
function string(value, maximum = 4095) {
  if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value) > maximum || Buffer.from(value).toString('utf8') !== value) failure('INVALID_INPUT','Invalid bounded Unicode string');
  return value;
}
function integer(value, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) failure('INVALID_INPUT','Invalid bounded integer');
  return value;
}
function byteBudget(value, maximum, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) failure('INVALID_INPUT','Invalid byte budget');
  if (value < minimum || value > maximum) failure('TOO_LARGE','Byte budget exceeds this operation limit');
  return value;
}
function identity(value) {
  object(value,['device','inode'],['device','inode']);
  for (const key of ['device','inode']) if (typeof value[key] !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value[key]) || BigInt(value[key]) > 18446744073709551615n) failure('INVALID_INPUT','Invalid physical identity');
  return value;
}
function revision(value) {
  object(value,['device','inode','size','changedNs','modifiedNs','hash'],['device','inode','size','changedNs','modifiedNs','hash']);
  identity({device:value.device,inode:value.inode});integer(value.size,ASSET);
  for (const key of ['changedNs','modifiedNs']) if (typeof value[key] !== 'string' || !/^-?(0|[1-9]\d{0,38})$/.test(value[key])) failure('INVALID_INPUT','Invalid nanosecond revision');
  if (typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)) failure('INVALID_INPUT','Invalid revision hash');
  return value;
}
// Validate one JSON document, including duplicate keys, before JSON.parse.
// Depth and byte limits are independent of the native filesystem authority.
function parse(source) {
  let at = 0;
  const white = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  function token() {
    const start = at++; let escaped = false;
    while (at < source.length) {
      const char = source[at++];
      if (!escaped && char === '"') return JSON.parse(source.slice(start,at));
      if (!escaped && char === '\\') escaped = true; else escaped = false;
    }
    failure('INVALID_INPUT','Unterminated JSON string');
  }
  function value(depth) {
    if (depth > 128) failure('INVALID_INPUT','JSON nesting limit exceeded');
    white();const char = source[at];
    if (char === '"') { token();return; }
    if (char === '{' || char === '[') {
      at++;white();const end = char === '{' ? '}' : ']', keys = new Set();
      if (source[at] === end) {at++;return;}
      for (let count = 0; count < 100001; count++) {
        white();
        if (char === '{') {
          if (source[at] !== '"') failure('INVALID_INPUT','JSON object key required');
          const key = token();if (keys.has(key)) failure('INVALID_INPUT','Duplicate JSON object key');keys.add(key);
          white();if (source[at++] !== ':') failure('INVALID_INPUT','JSON key separator required');
        }
        value(depth+1);white();if (source[at] === end) {at++;return;}
        if (source[at++] !== ',') failure('INVALID_INPUT','JSON element separator required');
      }
      failure('TOO_LARGE','JSON collection limit exceeded');
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at));
    if (!match) failure('INVALID_INPUT','Invalid JSON value');at += match[0].length;
  }
  value(0);white();if (at !== source.length) failure('INVALID_INPUT','Exactly one JSON request required');
  return JSON.parse(source);
}
function rootRequest(req, native) {
  const root = object(req.root,['path','sourcePath','identity','privateObjects'],['path','identity']);
  string(root.path);identity(root.identity);
  if (!root.path.startsWith('/')) failure('INVALID_INPUT','Absolute root required');
  if (root.privateObjects !== undefined && typeof root.privateObjects !== 'boolean') failure('INVALID_INPUT','privateObjects must be a boolean');
  const source = root.sourcePath === undefined ? root.path : string(root.sourcePath);
  const handle = native.openRoot(source,root.identity.device,root.identity.inode);
  try { if(root.privateObjects)native.usePrivate(handle);if (native.rootInfo(handle).path !== root.path) failure('STALE_ROOT','Root canonical path changed');return handle; }
  catch(error) {native.close(handle);throw error;}
}
function identityKey(value) { return value.device+':'+value.inode; }
function protectedRequest(req) {
  if(req.protected===undefined)return new Set();
  if(!Array.isArray(req.protected))failure('INVALID_INPUT','Protected identities must be an array');
  return new Set(req.protected.map(value=>identityKey(identity(value))));
}
function checkProtected(native,root,path,ids,ancestors=true) {
  if(!ids.size)return;
  const reject=value=>{if(ids.has(identityKey(value)))failure('INTERNAL_OBJECT','Application recovery objects are private');};
  if(ancestors)for(const value of native.rootAncestors(root))reject(value);
  const parts=path.split('/');
  for(let count=1;count<=parts.length;count++) {
    let item;
    try {item=native.openRelative(root,parts.slice(0,count).join('/'));reject(native.metadata(item).identity);}
    finally {if(item)native.close(item);}
  }
}
function metaRevision(meta, hash) {
  return { ...meta.identity, size:meta.size, modifiedNs:meta.modifiedNs, changedNs:meta.changedNs, hash };
}
function checkRevision(meta, expected) {
  for (const key of ['device','inode']) if (meta.identity[key] !== expected[key]) failure('CHANGED','Physical file identity changed');
  for (const key of ['size','modifiedNs','changedNs']) if (meta[key] !== expected[key]) failure('CHANGED','File revision changed');
}
function hashFile(native, file, meta) {
  byteBudget(meta.size,ASSET);const hash=createHash('sha256');
  for (let offset=0;offset<meta.size;offset+=CHUNK) hash.update(native.readBytes(file,offset,Math.min(CHUNK,meta.size-offset)));
  native.verify(file);return hash.digest('hex');
}
// Checkpoint source/root fields are issued-document metadata. They are never
// resolved/opened here: an already opened buffer can outlive its source lease.
const OFFICE_DRAFT=41*1024*1024, JOURNAL=64*1024;
function hashString(value) {if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))failure('INVALID_INPUT','Expected SHA256');return value;}
function uuid(value) {if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))failure('INVALID_INPUT','Invalid draft identifier');return value;}
function formatLimit(encoding='utf-8') {if(encoding!=='utf-8'&&encoding!=='ooxml-draft')failure('INVALID_INPUT','Unknown draft encoding');return encoding==='ooxml-draft'?OFFICE_DRAFT:TEXT;}
function sourceMetadata(value) {
  object(value,['kind','id','scope'],['kind','id','scope']);
  if(!['project-directory','task-cwd'].includes(value.kind))failure('INVALID_INPUT','Invalid draft source');
  string(value.id,128);if(!value.id)failure('INVALID_INPUT','Source identifier required');
  const scope=value.scope;
  if(scope?.kind==='project') {object(scope,['kind','projectId'],['kind','projectId']);string(scope.projectId,128);if(!scope.projectId)failure('INVALID_INPUT','Project identifier required');}
  else if(scope?.kind==='task') {object(scope,['kind','taskId'],['kind','taskId']);string(scope.taskId,128);if(!scope.taskId)failure('INVALID_INPUT','Task identifier required');}
  else failure('INVALID_INPUT','Invalid draft scope');
  return value;
}
function rootMetadata(value) {
  object(value,['path','sourcePath','identity','privateObjects'],['path','identity']);
  for(const field of ['path','sourcePath'])if(value[field]!==undefined){string(value[field]);if(!value[field].startsWith('/')||value[field].startsWith('//'))failure('INVALID_INPUT','Local absolute source metadata required');}
  identity(value.identity);if(value.privateObjects!==undefined&&typeof value.privateObjects!=='boolean')failure('INVALID_INPUT','Invalid source metadata flag');return value;
}
function checkpointLeaf(value) {if(value!=='draft'&&!(typeof value==='string'&&/^draft-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)))failure('UNTRUSTED','Invalid recorded draft leaf');return value;}
function decodedDraft(value,limit) {
  if(typeof value!=='string'||value.length>Math.ceil(limit/3)*4)failure('TOO_LARGE','Draft exceeds its format budget');
  const bytes=Buffer.from(value,'base64');if(bytes.length>limit)failure('TOO_LARGE','Draft exceeds its format budget');
  if(bytes.toString('base64')!==value)failure('INVALID_INPUT','Invalid canonical draft base64');return bytes;
}
function checkpointOperation(req,native,resolve=false) {
  const common=['operation','recoveryRoot','projectKey','draftId','bufferVersion','fingerprint'];
  const fields=resolve?['hash']:['root','relativePath','source','baseHash','base64','encoding','bom'];
  object(req,[...common,...fields],[...common,...(resolve?['hash']:['root','relativePath','source','baseHash','base64'])]);
  hashString(req.projectKey);uuid(req.draftId);hashString(req.fingerprint);integer(req.bufferVersion,Number.MAX_SAFE_INTEGER);
  let bytes;
  if(resolve)hashString(req.hash);
  else {
    rootMetadata(req.root);sourceMetadata(req.source);hashString(req.baseHash);string(req.relativePath);
    if(!req.relativePath||req.relativePath.startsWith('/')||req.relativePath.split('/').some(x=>!x||x==='.'||x==='..'))failure('INVALID_INPUT','Invalid draft relative path');
    if(req.bom!==undefined&&typeof req.bom!=='boolean')failure('INVALID_INPUT','Invalid draft BOM metadata');
    bytes=decodedDraft(req.base64,formatLimit(req.encoding));
  }
  let root,record,current;
  const handles=new Set();
  const remember=h=>{handles.add(h);return h;};
  const close=h=>{if(h){native.close(h);handles.delete(h);}};
  const context={project:req.projectKey,id:req.draftId,relative:req.projectKey+'/'+req.draftId};
  function privateRead(leaf,limit) {
    native.verify(record.handle);let file;
    try {
      file=remember(native.openRelative(root,context.relative+'/'+leaf));const meta=native.metadata(file);
      if(meta.kind!=='file')failure('NOT_REGULAR','Private material must be a regular file');
      byteBudget(meta.size,limit);if(identityKey(meta.parentIdentity)!==identityKey(native.metadata(record.handle).identity))failure('UNTRUSTED','Private record parent identity changed');
      const hash=hashFile(native,file,meta);native.verify(record.handle);return {file,meta,hash};
    } catch(error) {close(file);throw error;}
  }
  function journal() {
    const observed=privateRead('journal.json',JOURNAL);
    try {
      const data=native.readBytes(observed.file,0,observed.meta.size);if(createHash('sha256').update(data).digest('hex')!==observed.hash)failure('CHANGED','Journal bytes changed');
      let value;try {value=parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{failure('UNTRUSTED','Invalid recovery journal; original retained');}
      if(!value||typeof value!=='object'||Array.isArray(value)||value.opId!==req.draftId||value.projectKey!==req.projectKey)failure('UNTRUSTED','Recovery journal reference changed');
      native.verify(observed.file);native.verify(record.handle);return {...observed,value};
    } catch(error) {close(observed.file);throw error;}
  }
  function checkedDraft(previous,leaf=previous.draftLeaf,expectedIdentity=previous.draftIdentity,expectedHash=previous.draftHash,limit=formatLimit(previous.encoding)) {
    checkpointLeaf(leaf);if(!expectedIdentity)failure('CONFLICT','Draft identity was not confirmed durable');identity(expectedIdentity);hashString(expectedHash);
    const observed=privateRead(leaf,limit);
    if(identityKey(observed.meta.identity)!==identityKey(expectedIdentity)||observed.hash!==expectedHash)failure('CONFLICT','Previously recorded private draft changed; all versions retained');
    return observed;
  }
  function writeJournal(value,previous) {
    const data=Buffer.from(JSON.stringify(value),'utf8');byteBudget(data.length,JOURNAL);
    const leaf='journal-'+randomUUID(),created=native.createPrivateFile(record.handle,leaf,data);
    native.installPrivateJournal(record.handle,leaf,previous?.file??null);
    const installed=journal();
    if(identityKey(installed.meta.identity)!==identityKey(created.identity)||installed.hash!==createHash('sha256').update(data).digest('hex'))failure('CONFLICT','Installed journal changed; material retained');
    if(previous) {
      close(previous.file);const displaced=privateRead(leaf,JOURNAL);
      if(identityKey(displaced.meta.identity)!==identityKey(previous.meta.identity)||displaced.hash!==previous.hash)failure('CONFLICT','Displaced journal changed; retained');
      native.removePrivateFile(record.handle,leaf,displaced.file);close(displaced.file);
    }
    return installed;
  }
  try {
    root=rootRequest({root:{...req.recoveryRoot,privateObjects:true}},native);
    if(!resolve)native.checkPrivateSpace(root,bytes.length+JOURNAL);
    record=native.beginPrivateRecord(root,req.projectKey,req.draftId,!resolve);
    try {current=journal();}catch(error) {
      if(error.code!=='MISSING'||resolve)throw error;
      if(!record.created)failure('UNTRUSTED','Existing private record has no valid journal; retained');
    }
    const previous=current?.value;
    if(previous) {
      if(previous.kind!=='checkpoint'||previous.fingerprint!==req.fingerprint)failure(resolve?'UNTRUSTED':'IDEMPOTENCY','Draft belongs to a different issued document');
      if(identityKey(identity(previous.recordIdentity))!==identityKey(native.metadata(record.handle).identity))failure('UNTRUSTED','Private record directory was replaced');
    }
    if(resolve) {
      if(previous.bufferVersion!==req.bufferVersion||previous.draftHash!==req.hash)return {resolved:false};
      checkedDraft(previous);current=writeJournal({...previous,state:'resolved',resolvedAt:Date.now()},current);return {resolved:true};
    }
    const digest=createHash('sha256').update(bytes).digest('hex');
    if(previous) {
      integer(previous.bufferVersion,Number.MAX_SAFE_INTEGER);
      if(previous.bufferVersion>req.bufferVersion)failure('CHANGED','A newer draft is already durable');
      if(previous.bufferVersion===req.bufferVersion) {
        if(previous.draftHash!==digest||previous.baseHash!==req.baseHash||formatLimit(previous.encoding)!==formatLimit(req.encoding))failure('IDEMPOTENCY','Draft version reused with different bytes or metadata');
        if(!['dirty','resolved'].includes(previous.state))failure('IO','Previous checkpoint was not confirmed durable');
        checkedDraft(previous);return {draftId:req.draftId,bufferVersion:previous.bufferVersion,hash:previous.draftHash};
      }
    }
    const leaf='draft-'+randomUUID(),now=Date.now();
    const value={schemaVersion:1,kind:'checkpoint',opId:req.draftId,projectKey:req.projectKey,fingerprint:req.fingerprint,root:req.root,relativePath:req.relativePath,source:req.source,baseHash:req.baseHash,draftHash:digest,bufferVersion:req.bufferVersion,encoding:req.encoding??'utf-8',bom:req.bom??false,draftLeaf:leaf,state:'preparing',recordIdentity:native.metadata(record.handle).identity,createdAt:previous?.createdAt??now,updatedAt:now,bytes:Math.max(previous?.bytes??0,bytes.length*3+JOURNAL)};
    let obsolete;
    if(previous) {
      checkedDraft(previous);value.previousDraft={leaf:previous.draftLeaf,identity:previous.draftIdentity,hash:previous.draftHash};
      if(previous.previousDraft) {obsolete=checkedDraft(previous,previous.previousDraft.leaf,previous.previousDraft.identity,previous.previousDraft.hash,OFFICE_DRAFT);}
    } else current=writeJournal(value,null);
    value.draftIdentity=native.createPrivateFile(record.handle,leaf,bytes).identity;
    value.state='dirty';native.verify(root);current=writeJournal(value,current);
    if(obsolete) {
      // Only a superseded draft belonging to this same checkpoint is eligible.
      // A saved/conflict/displaced record never reaches this cleanup branch.
      native.removePrivateFile(record.handle,previous.previousDraft.leaf,obsolete.file);close(obsolete.file);
    }
    return {draftId:req.draftId,bufferVersion:req.bufferVersion,hash:digest};
  } finally {
    for(const handle of handles)native.close(handle);
    if(record)native.close(record.handle);if(root)native.close(root);
  }
}

function handleRequest(req, native) {
  if (!req || typeof req !== 'object' || typeof req.operation !== 'string') failure('INVALID_INPUT','Operation required');
  const operation = req.operation;
  if(operation==='checkpoint'||operation==='resolve-checkpoint')return checkpointOperation(req,native,operation==='resolve-checkpoint');
  if (!['inspect-root','initialize-recovery','metadata','stat','read','chunk','list'].includes(operation)) failure('UNSUPPORTED','Linux read core does not implement this operation');
  if (operation === 'inspect-root' || operation === 'initialize-recovery') {
    object(req,['operation','path'],['operation','path']);const path=string(req.path);
    const root=native.openRoot(path,'','');try { return operation === 'initialize-recovery' ? native.initializeRecovery(root) : native.rootInfo(root); } finally {native.close(root);}
  }
  const common=['operation','root','relativePath','protected','expectedParentIdentity'];
  const extra=operation==='list'?['requestId']:operation==='read'?['byteLimit']:operation==='chunk'?['offset','length','expectedHash','expectedRevision','resourceLimit','byteLimit']:[];
  object(req,[...common,...extra],['operation','root','relativePath']);const path=string(req.relativePath);
  // The main service owns cancellation; this identifier carries no file authority.
  if(req.requestId!==undefined)uuid(typeof req.requestId==='string'?req.requestId.toLowerCase():req.requestId);
  const protectedIds=protectedRequest(req);
  if(req.expectedParentIdentity!==undefined)identity(req.expectedParentIdentity);
  let root, file;
  try {
    root=rootRequest(req,native);checkProtected(native,root,path,protectedIds);
    file=native.openRelative(root,path);const meta=native.metadata(file);
    const relativePath=meta.relativePath==='.'?'':meta.relativePath;
    if(relativePath!==path)checkProtected(native,root,relativePath,protectedIds);
    if (operation==='list') {
      if (meta.kind!=='directory') failure('NOT_REGULAR','Directory required');
      const entries=native.listNames(file).map(entry=>{
        if(protectedIds.has(identityKey(entry.identity)))return null;
        const relative=relativePath?relativePath+'/'+entry.name:entry.name;let child;
        try {
          checkProtected(native,root,relative,protectedIds,false);
          child=native.openRelative(root,relative);const value=native.metadata(child);
          if(value.relativePath!==relative)checkProtected(native,root,value.relativePath==='.'?'':value.relativePath,protectedIds,false);
          return {...entry,relativePath:relative,identity:value.identity,size:value.size,kind:value.kind};
        }
        catch(error) {if(error.code==='INTERNAL_OBJECT')return null;return {...entry,relativePath:relative,kind:'unavailable',reason:String(error.message).slice(0,4096)};}
        finally {if(child)native.close(child);}
      }).filter(Boolean);native.verify(file);checkProtected(native,root,relativePath,protectedIds);return {entries,identity:meta.identity,relativePath};
    }
    if(req.expectedParentIdentity!==undefined&&identityKey(meta.parentIdentity)!==identityKey(req.expectedParentIdentity))failure('UNTRUSTED','Recovery material directory changed');
    if (meta.kind!=='file') failure('NOT_REGULAR','Regular file required');
    if (operation==='metadata') return {identity:meta.identity,relativePath,size:meta.size,modifiedNs:meta.modifiedNs,changedNs:meta.changedNs};
    byteBudget(meta.size,ASSET);
    let cached;
    if (operation==='chunk' && req.expectedRevision !== undefined) {cached=revision(req.expectedRevision);checkRevision(meta,cached);}
    const rev=cached??metaRevision(meta,hashFile(native,file,meta));
    if (req.expectedHash !== undefined && req.expectedHash !== rev.hash) failure('CHANGED','Resource hash changed');
    const result={revision:rev,relativePath,writable:meta.writable};
    if (operation==='stat') result.sampleBase64=native.readBytes(file,0,Math.min(4096,meta.size)).toString('base64');
    if (operation==='read'||operation==='chunk') {
      const limit=req.byteLimit===undefined?TEXT:byteBudget(req.byteLimit,TEXT);
      let offset=0,length=Math.min(limit,meta.size);
      if (operation==='chunk') {
        offset=integer(req.offset,ASSET);length=byteBudget(req.length,CHUNK);
        const resourceLimit=req.resourceLimit===undefined?ASSET:byteBudget(req.resourceLimit,ASSET,1);
        if (meta.size>resourceLimit) failure('TOO_LARGE','Resource exceeds the declared budget');
      } else if (meta.size>limit) failure('TOO_LARGE','File exceeds text read limit');
      result.base64=native.readBytes(file,offset,length).toString('base64');
      if (!cached && hashFile(native,file,meta)!==rev.hash) failure('CHANGED','File changed during read');
    }
    checkRevision(native.metadata(file),rev);native.verify(file);checkProtected(native,root,path,protectedIds);if(relativePath!==path)checkProtected(native,root,relativePath,protectedIds);return result;
  } finally {if(file)native.close(file);if(root)native.close(root);}
}
let emitted = false;
function emit(frame,code) {
  if (emitted) return;emitted=true;let line=JSON.stringify(frame)+'\n';
  if (Buffer.byteLength(line)>OUTPUT) {line=JSON.stringify({error:{code:'TOO_LARGE',message:'Response exceeds existing protocol budget'}})+'\n';code=1;}
  process.exitCode=code;process.stdout.write(line);
}
async function main() {
  if (process.platform !== 'linux') failure('UNSUPPORTED','Actual target Linux runtime required');
  for (const name of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH']) if (process.env[name]) failure('UNTRUSTED','Unsafe inherited loader environment');
  if (+process.versions.napi<8) failure('UNSUPPORTED','C Node-API8 runtime required');
  const native=require('./fd-authority.node');let count=0;const parts=[];
  for await (const part of process.stdin) {count+=part.length;if(count>CHECKPOINT_INPUT) failure('TOO_LARGE','Request exceeds maximum checkpoint frame budget');parts.push(part);}
  let request;try {request=parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,count)));}
  catch(error) {if(count>INPUT)failure('TOO_LARGE','Oversized request is not a valid checkpoint frame');if(CODES.has(error.code))throw error;failure('INVALID_INPUT','Malformed JSON or UTF-8 request');}
  if(count>INPUT&&request?.operation!=='checkpoint')failure('TOO_LARGE','Read-only request exceeds byte budget');
  emit({result:handleRequest(request,native)},0);
}
main().catch(error=>emit({error:{code:CODES.has(error.code)?error.code:'IO',message:String(error.message||'Linux read core failed').slice(0,4096)}},1));
