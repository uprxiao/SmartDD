import {openSync,writeSync,fsyncSync,closeSync,readFileSync,statSync,ftruncateSync,mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
export class Framer {
 constructor(maxBytes,onFrame){this.max=maxBytes;this.slab=Buffer.alloc(maxBytes);this.used=0;this.peak=0;this.onFrame=onFrame;this.frames=0;this.failed=false;}
 feed(chunk){if(this.failed)throw Error('stream failed');try{let at=0;while(at<chunk.length){const newline=chunk.indexOf(10,at);const end=newline<0?chunk.length:newline;const size=end-at;if(this.used+size>this.max)throw Error('frame-too-large');chunk.copy(this.slab,this.used,at,end);this.used+=size;this.peak=Math.max(this.peak,this.used);if(newline<0)return;let length=this.used;if(length&&this.slab[length-1]===13)length--;const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(this.slab.subarray(0,length)));this.used=0;this.onFrame(value);this.frames++;at=newline+1;}}catch(e){this.failed=true;throw e;}}
 end(){if(this.used){this.failed=true;throw Error('incomplete-frame');}}
}
export class ArtifactSink {
 constructor(root,quota=32*1024*1024){mkdirSync(root,{recursive:true});this.path=join(root,'output.bin');this.fd=openSync(this.path,'a+');this.db=new DatabaseSync(join(root,'state.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,start INTEGER NOT NULL,bytes INTEGER NOT NULL,hash TEXT NOT NULL,preview TEXT NOT NULL);');this.quota=quota;this.faulted=false;this.peakPreview=0;}
 offset(){return this.db.prepare('SELECT COALESCE(MAX(start+bytes),0) AS n FROM events').get().n;}
 count(){return this.db.prepare('SELECT count(*) AS n FROM events').get().n;}
 append(bytes,hash,inject){if(this.faulted)throw Error('recovery-required');const start=this.offset();if(start+bytes.length>this.quota)throw Error('artifact-quota');if(statSync(this.path).size!==start)throw Error('unreconciled-tail');let tx=false;try{if(inject==='write-error')throw Object.assign(Error('injected ENOSPC'),{code:'ENOSPC'});let at=0;while(at<bytes.length){const n=writeSync(this.fd,bytes,at,bytes.length-at);if(n===0)throw Error('short-write');at+=n;}fsyncSync(this.fd);if(inject==='after-file')throw Error('injected-after-file');this.db.exec('BEGIN IMMEDIATE');tx=true;const preview=bytes.subarray(0,64).toString('hex');this.peakPreview=Math.max(this.peakPreview,Buffer.byteLength(preview));this.db.prepare('INSERT INTO events VALUES (?,?,?,?,?)').run(this.count()+1,start,bytes.length,hash,preview);if(inject==='before-commit')throw Error('injected-before-commit');this.db.exec('COMMIT');tx=false;}catch(e){if(tx){try{this.db.exec('ROLLBACK')}catch{}}this.faulted=true;throw e;}}
 recover(){const committed=this.offset();const size=statSync(this.path).size;if(size<committed)throw Error('committed-content-missing');if(size>committed){ftruncateSync(this.fd,committed);fsyncSync(this.fd);}this.faulted=false;return committed;}
 close(){const row=this.db.prepare('PRAGMA integrity_check').get();if(row.integrity_check!=='ok')throw Error('sqlite integrity');this.db.close();closeSync(this.fd);}
}
