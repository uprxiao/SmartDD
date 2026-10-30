import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { NativeFileBroker } from '../native-broker';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const rows: unknown[] = [];
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_DOCX_APP || !process.env.SMARTDD_DOCX_FIXTURES || !process.env.SMARTDD_DOCX_WORKER_EVIDENCE)('W07 actual native DOCX source, Worker launch faults and fixed layout recovery', () => {
  it.each(['normal', 'missing-entry', 'missing-import'])('%s preserves source and renders an independently verified complex document', async mode => {
    const app = process.env.SMARTDD_DOCX_APP!, evidence = process.env.SMARTDD_DOCX_WORKER_EVIDENCE!, fixture = JSON.parse(readFileSync(process.env.SMARTDD_DOCX_FIXTURES!, 'utf8'));
    const base = mkdtempSync('/private/tmp/willyou-docx-worker-I-'), project = join(base, 'project'), userData = join(base, 'userdata'); mkdirSync(project); mkdirSync(userData); mkdirSync(evidence, {recursive:true});
    const input = join(project, 'complex.docx'); copyFileSync(join(fixture.project, 'font-fallback.docx'), input); const original = readFileSync(input), sourceHash = sha(original);
    const native = join(app, 'Contents/Resources/native'), actualWorker = join(app, 'Contents/Resources/app.asar/out/main/m9-office-pages.js'), bootstrap = join(base, 'm9-office-pages.js');
    if (mode === 'missing-import') writeFileSync(bootstrap, 'require(' + JSON.stringify(join(base, 'intentionally-missing-dependency.cjs')) + ');\n');
    const broker = new NativeFileBroker(join(native, 'willyou-files')), resolver = { sources: () => [{ kind:'project-directory' as const, id:'root', path:project, label:'W07 synthetic source', projectId:'w07' }] };
    const files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver), undefined, undefined, undefined, undefined, undefined, { userData, directory:join(native,'libreoffice'), packagePath:app }, mode === 'normal' ? actualWorker : bootstrap);
    const request = vi.spyOn(broker, 'request'); const owner = 'w07'; let failedId: string | undefined;
    try {
      const root = (await files.openScope(owner, {kind:'project',projectId:'w07'})).roots[0], file = await files.open(owner, {lease:root.lease,generation:root.generation,relativePath:'complex.docx'});
      expect(file.revision.hash).toBe(sourceHash); request.mockClear();
      if (mode !== 'normal') {
        failedId = randomUUID(); await expect(files.officePages.open(owner, {id:failedId,ref:file.ref,baseHash:sourceHash})).rejects.toMatchObject({code:'IO'});
        expect(files.officePages.activeDocuments).toBe(0); expect(() => files.officePages.chunk(owner, failedId!, 0, 1)).toThrow(/UNTRUSTED/);
        expect(request.mock.calls.some(([input]) => input.operation === 'office-render')).toBe(false);
        // Same source/service and configured entry; restore a transparent import
        // of the actual shipped Worker, not a fabricated successful response.
        writeFileSync(bootstrap, 'require(' + JSON.stringify(actualWorker) + ');\n');
      }
      const id = randomUUID(), output = await files.officePages.open(owner, {id,ref:file.ref,baseHash:sourceHash});
      expect(output.pages).toBe(2); expect(output.sourceHash).toBe(sourceHash); expect(output.info).toMatchObject({kind:'docx',hasRevisions:true});
      const chunks: Buffer[] = []; for (let offset=0;offset<output.bytes;offset+=1024*1024) chunks.push(Buffer.from(files.officePages.chunk(owner,id,offset,Math.min(1024*1024,output.bytes-offset)),'base64'));
      const pdf = Buffer.concat(chunks); expect(sha(pdf)).toBe(output.hash); expect(pdf.subarray(0,5).toString()).toBe('%PDF-');
      const out = join(evidence,mode); mkdirSync(out,{recursive:true}); copyFileSync(input,join(out,'input.docx')); const pdfPath = join(out,'actual.pdf'); writeFileSync(pdfPath,pdf);
      const independent = JSON.parse(execFileSync('python3',[resolve('scripts/files/docx-preview-fixtures.py'),'verify',input,pdfPath,out],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}));
      expect(Object.values(independent.comparisons).every(Boolean)).toBe(true); expect(independent.sourceInfo.sha256).toBe(sourceHash);
      files.officePages.release(owner,id); expect(files.officePages.activeDocuments).toBe(0); expect(() => files.officePages.chunk(owner,id,0,1)).toThrow(/UNTRUSTED/);
      expect(readFileSync(input)).toEqual(original); rows.push({caseId:'M9-T-W07',mode,sourceHash,worker:actualWorker,workerSha256:sha(readFileSync(actualWorker)),failedId,output,independent,sourceUnchanged:true,scope:'I real FileService/native source and packaged Worker/LibreOffice. Two fault modes use an owned missing entry/import bootstrap; same service recovers through a transparent import of the unchanged shipped Worker. Not GUI A.'});
    } finally { request.mockRestore(); files.closeOwner(owner); files.officePages.dispose(); await files.watcher.dispose(); broker.dispose(); rmSync(base,{recursive:true,force:true}); }
  },90000);
});
afterAll(() => { if (process.env.SMARTDD_DOCX_WORKER_EVIDENCE) { mkdirSync(process.env.SMARTDD_DOCX_WORKER_EVIDENCE,{recursive:true}); writeFileSync(join(process.env.SMARTDD_DOCX_WORKER_EVIDENCE,'result.json'),JSON.stringify({at:new Date().toISOString(),layer:'I',app:process.env.SMARTDD_DOCX_APP,rows},null,2)+'\n'); } });
