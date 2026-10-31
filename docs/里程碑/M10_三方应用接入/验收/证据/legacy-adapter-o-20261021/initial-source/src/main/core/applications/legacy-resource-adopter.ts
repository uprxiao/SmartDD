import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { treeHash } from '../capabilities/assets';
import { readOwnedTree, writeOwnedTree } from '../capabilities/files';
import { fileNames, ensureStoreDirectory } from './package-files';
import type { ResourceRecord, ResourceStore } from './resource-store';
/** Preserve the original M4 paths, bytes, marker and legacy-tree-v1 algorithm. */
export class LegacyCapabilityResourceAdopter {
  constructor(readonly store: ResourceStore) {}
  private read(relative: string,expectedHash: string): Record<string,string> {
    ensureStoreDirectory(this.store.root,dirname(relative)); return this.readDirectory(join(this.store.root,relative),expectedHash);
  }
  private readDirectory(root: string,expectedHash: string): Record<string,string> {
    try {
      const names = fileNames(root);
      if (!names.includes('.smartdd-owned.json') || names.some(n => lstatSync(join(root,n)).nlink !== 1)) throw new Error('legacy ownership');
      const marker = JSON.parse(readFileSync(join(root,'.smartdd-owned.json'),'utf8')); if (marker.owner !== 'SmartDD' || marker.schema !== 1 || Object.keys(marker).length !== 2) throw new Error('legacy marker');
      const files = readOwnedTree(root);
      if (Object.entries(files).some(([path,text]) => !Buffer.from(text,'utf8').equals(readFileSync(join(root,path)))) || treeHash(files) !== expectedHash) throw new Error('legacy full hash'); return files;
    } catch { throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原M4完整资源或归属无法核验，不能从当前版本猜测补齐'); }
  }
  async adoptStandard(skillId: string,hash: string): Promise<ResourceRecord> { if (!/^[a-z][a-z0-9-]{0,63}$/.test(skillId) || !/^[a-f0-9]{64}$/.test(hash)) throw new ApplicationError('INVALID_INPUT','标准Skill身份无效'); return this.adopt('standard-skill',`standard-skill:${skillId}:${hash}`,`packages/${skillId}/${hash}`,hash); }
  async adoptRuntime(hash: string): Promise<ResourceRecord> { if (!/^[a-f0-9]{64}$/.test(hash)) throw new ApplicationError('INVALID_INPUT','历史运行资源摘要无效'); return this.adopt('legacy-runtime','legacy-runtime:' + hash,'runtime/' + hash,hash); }
  private async adopt(kind: string,resourceId: string,relativePath: string,hash: string): Promise<ResourceRecord> {
    const files = this.read(relativePath,hash);
    return this.store.publish({ resourceId,kind,contentHash: hash,relativePath,dependencies: [],materialize: stage => writeOwnedTree(stage,files,join(this.store.root,'conflicts')),verify: directory => { this.readDirectory(directory,hash); } });
  }
  verify(resource: ResourceRecord): Record<string,string> {
    if (!['standard-skill','legacy-runtime'].includes(resource.kind) || resource.ownerStoreId !== this.store.storeId || resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4资源尚未就绪');
    if (resource.kind === 'standard-skill' && resource.relativePath !== 'packages/' + resource.resourceId.slice('standard-skill:'.length).replace(':','/')) throw new ApplicationError('OWNERSHIP_CONFLICT','标准Skill原路径不同');
    if (resource.kind === 'legacy-runtime' && resource.relativePath !== 'runtime/' + resource.contentHash) throw new ApplicationError('OWNERSHIP_CONFLICT','历史运行资源原路径不同');
    return this.read(resource.relativePath,resource.contentHash);
  }
}
