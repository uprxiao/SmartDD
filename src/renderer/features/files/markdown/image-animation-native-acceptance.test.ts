import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileBuffer } from '../file-buffer';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { loadMarkdownImage } from './images';
import { imageMenuActions } from '@shared/image-menu-policy.mjs';

const bridge = vi.hoisted(() => ({ files: null as FileService | null, owner: 'v08-image-animation' }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {
  related: (...args: any[]) => (bridge.files!.related as any)(bridge.owner, ...args),
  chunk: (...args: any[]) => (bridge.files!.chunk as any)(bridge.owner, ...args),
  closeDocument: async (...args: any[]) => (bridge.files!.closeDocument as any)(bridge.owner, ...args),
} } }));
const rows: unknown[] = [], sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
afterAll(() => { if (process.env.WILLYOU_V08_I_EVIDENCE) writeFileSync(process.env.WILLYOU_V08_I_EVIDENCE, JSON.stringify({ layer: 'I', boundary: 'Actual FileService/native related/chunk/source classification, production image load helper, original native prepareCopy/copyTo. Copy destination is explicit own test path, not a native picker/App save claim. Node blob decoder is not browser image decoding.', rows }, null, 2)+'\n'); });
describe.skipIf(!process.env.WILLYOU_V08_FIXTURES || !process.env.SMARTDD_FILES_NATIVE_PATH)('V08 actual source MIME and animation copy boundaries', () => {
  it('uses actual source MIME, preserves GIF bytes/extension on a native copy, and records PNG named .gif conservatively', async () => {
    const f = JSON.parse(readFileSync(process.env.WILLYOU_V08_FIXTURES!, 'utf8'));
    const base = mkdtempSync('/private/tmp/willyou-image-animation-I-'), project = join(base, 'project'); mkdirSync(project); mkdirSync(join(base, 'userdata'));
    for (const name of [f.markdown, ...f.cases.map((c: any) => c.name)]) copyFileSync(join(f.project, name), join(project, name));
    const before = Object.fromEntries([f.markdown, ...f.cases.map((c: any) => c.name)].map(name => { const p=join(project,name),s=statSync(p,{bigint:true});return [name,{sha256:sha(readFileSync(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]; }));
    const broker = new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!);
    const scope = { kind: 'project' as const, projectId: 'v08' }, owner = bridge.owner;
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', projectId: 'v08', path: project, label: 'V08 owned images' }] };
    const files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base,'userdata'), resolver)); bridge.files=files;
    try {
      const root=(await files.openScope(owner,scope)).roots[0], parent=await files.open(owner,{lease:root.lease,generation:root.generation,relativePath:f.markdown});
      for (const item of f.cases) {
        const controller = new AbortController(), element = { alt: item.name, dataset: {}, src: '' } as HTMLImageElement;
        const loaded = await loadMarkdownImage({file:parent} as FileBuffer, element, item.name, controller.signal);
        try {
          expect(loaded.mime).toBe(item.mime); expect(loaded.animated).toBe(item.hostAnimated); expect(loaded.hash).toBe(item.sha256);
          expect(sha(new Uint8Array(await (await fetch(loaded.src)).arrayBuffer()))).toBe(item.sha256);
          const menu = imageMenuActions({ src:item.name,localPath:loaded.path,animated:loaded.animated });
          expect(menu.some(x=>x.id==='copy')).toBe(!item.hostAnimated); expect(menu.some(x=>x.id==='reference')).toBe(!item.hostAnimated);
          let copy;
          if(item.name==='animated.gif') {
            const doc=await files.related(owner,parent.ref,item.name);
            try {
              const selection=await files.actions.prepareCopy(owner,{target:{kind:'document',ref:doc.ref},baseHash:item.sha256}); expect(selection.name).toBe('animated.gif');
              const output=join(base,'actual-native-copy.gif'),receipt=await files.actions.copyTo(owner,selection,output);
              expect(receipt.state).toBe('saved');expect(receipt.hash).toBe(item.sha256); expect(sha(readFileSync(output))).toBe(item.sha256);
              const evidenceDir=process.env.WILLYOU_V08_I_EVIDENCE!+'.files';mkdirSync(evidenceDir,{recursive:true});copyFileSync(output,join(evidenceDir,'actual-native-copy.gif'));
              copy={selectionName:selection.name,receipt,archivedPath:join(evidenceDir,'actual-native-copy.gif')};
            } finally {files.closeDocument(owner,doc.ref);}
          }
          rows.push({name:item.name,sourceSha256:item.sha256,actualSourceMime:loaded.mime,hostAnimated:loaded.animated,independentActualCodec:item.actualCodec,independentActualFrames:item.actualFrames,menu,copy,pass:true});
        } finally {controller.abort();}
        await expect(fetch(loaded.src)).rejects.toThrow();
      }
      for (const [name, expected] of Object.entries(before)) {const p=join(project,name),s=statSync(p,{bigint:true});expect({sha256:sha(readFileSync(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}).toEqual(expected);}
      rows.push({sourceFingerprintsUnchanged:before,pass:true});
    } finally { files.closeOwner(owner); await files.watcher.dispose(); broker.dispose(); bridge.files=null; rmSync(base,{recursive:true,force:true}); }
  });
});
