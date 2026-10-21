import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseDocument } from 'yaml';
import { ApplicationError } from '@shared/applications';
import type { CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { canonicalJson, digest } from './manifest';
import { verifyPackageTree } from './package-files';
import { PackageRegistry } from './package-registry';
import { LegacyCapabilityResourceAdopter } from './legacy-resource-adopter';
import { ownedBundle, writeOwnedBundle, verifyOwnedBundle } from './owned-bundle';
import type { ResourceRecord, ResourceStore } from './resource-store';
import type { CapabilitySessionRegistry } from './session-registry';
export const standardNativeSkillName = (skillId: string,hash: string): string => {
  const name = `smartdd-s-${skillId}-${hash.slice(0,12)}`;
  if (name.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) throw new ApplicationError('INVALID_PACKAGE','标准Skill原生名称超过已验证范围'); return name;
};
export function projectSkillName(input: Buffer,name: string): Buffer {
  if (!Buffer.from(input.toString('utf8'),'utf8').equals(input)) throw new ApplicationError('INVALID_PACKAGE','Skill入口必须为完整UTF-8文本');
  const text = input.toString('utf8'), front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!front) throw new ApplicationError('INVALID_PACKAGE','Skill入口缺少元数据');
  const doc = parseDocument(front[1],{ uniqueKeys: true,logLevel: 'silent' });
  if (doc.errors.length || typeof doc.get('name') !== 'string' || typeof doc.get('description') !== 'string') throw new ApplicationError('INVALID_PACKAGE','Skill元数据无效');
  doc.set('name',name); return Buffer.from('---\n' + doc.toString() + '---\n' + text.slice(front[0].length),'utf8');
}
/** Full source trees are copied; relative scripts/references/assets remain alongside SKILL.md. */
export class SessionCapabilityProjector {
  private readonly packages: PackageRegistry;
  private readonly legacy: LegacyCapabilityResourceAdopter;
  constructor(readonly store: ResourceStore,private readonly sessions: CapabilitySessionRegistry) { this.packages = new PackageRegistry(store,'projection-reader'); this.legacy = new LegacyCapabilityResourceAdopter(store); }
  sourceSkills(snapshot: CapabilitySessionSnapshotV2,applicationScope?:readonly string[]): { nativeName: string;path: string;sourceHash: string;sourceResourceId: string;files: Record<string,Buffer>;executables: Set<string> }[] {
    if(applicationScope&&(!applicationScope.length||new Set(applicationScope).size!==applicationScope.length||applicationScope.some(id=>!snapshot.packages.some(p=>p.appId===id))))throw new ApplicationError('INVALID_INPUT','Skill加载范围须来自原固定应用');
    const result: ReturnType<SessionCapabilityProjector['sourceSkills']> = [];
    for (const application of snapshot.packages.filter(p=>applicationScope===undefined||applicationScope.includes(p.appId))) {
      const installed = this.packages.get(application.packageHash); verifyPackageTree(join(this.store.root,installed.relativePath),installed,this.store.storeId);
      for (const skill of application.skills) {
        const prefix = skill.sourceRelativePath + '/', files: Record<string,Buffer> = {},executables = new Set<string>();
        for (const source of installed.manifest.files.filter(f => f.path.startsWith(prefix))) { const relative = source.path.slice(prefix.length), bytes = readFileSync(join(this.store.root,installed.relativePath,source.path));if(bytes.length!==source.size||digest(bytes)!==source.sha256)throw new ApplicationError('HASH_MISMATCH','原Skill文件在读取时已改变'); files[relative] = relative === 'SKILL.md' ? projectSkillName(bytes,skill.nativeName) : bytes; if (source.executable) executables.add(relative); }
        if (!files['SKILL.md']) throw new ApplicationError('INVALID_PACKAGE','原Skill完整目录缺少入口');
        result.push({ nativeName: skill.nativeName,path: skill.projectionPath,sourceHash: skill.contentHash,sourceResourceId: installed.resourceId,files,executables });
      }
      verifyPackageTree(join(this.store.root,installed.relativePath),installed,this.store.storeId);
    }
    for (const standard of snapshot.standardSkills) {
      const resource = this.store.get(`standard-skill:${standard.skillId}:${standard.hash}`);
      const files: Record<string,Buffer> = Object.fromEntries(Object.entries(this.legacy.verify(resource)).map(([path,text]) => [path,Buffer.from(text,'utf8')]));
      const nativeName = standardNativeSkillName(standard.skillId,standard.hash);
      if (!files['SKILL.md']) throw new ApplicationError('INVALID_PACKAGE','原标准Skill缺少入口'); files['SKILL.md'] = projectSkillName(files['SKILL.md'],nativeName);
      result.push({ nativeName,path: standard.projectionPath,sourceHash: standard.hash,sourceResourceId: resource.resourceId,files,executables: new Set() });
    }
    if (new Set(result.map(s => s.nativeName)).size !== result.length) throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','所选Skill原生名称冲突'); return result;
  }
  async claude(taskId: string): Promise<{ resource: ResourceRecord;root: string }> {
    const current = await this.sessions.get(taskId), snapshot = current.snapshot;
    if (snapshot.runner !== 'claude-code' || snapshot.provenance !== 'created') throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此投影入口只处理有新会话依据的Claude能力；旧历史不猜测重建');
    const relativePath = `sessions/${taskId}/claude/plugin`, root = join(this.store.root,relativePath), skills = this.sourceSkills(snapshot), files: Record<string,Buffer> = {},executables = new Set<string>();
    files['.claude-plugin/plugin.json'] = Buffer.from(JSON.stringify({ name: 'smartdd-session',version: '1.0.0',description: 'WillYou session capabilities' },null,2) + '\n');
    for (const skill of skills) {
      if (skill.path !== join(root,'skills',skill.nativeName,'SKILL.md')) throw new ApplicationError('SNAPSHOT_IMMUTABLE','Skill投影路径不等于原快照');
      for (const [path,bytes] of Object.entries(skill.files)) { const target = `skills/${skill.nativeName}/${path}`; files[target] = bytes; if (skill.executables.has(path)) executables.add(target); }
    }
    const bundle = ownedBundle({ kind: 'claude-session-projection',taskId,selectionHash: current.selectionHash,formatVersion: 1,sources: skills.map(s => ({ resourceId: s.sourceResourceId,sourceHash: s.sourceHash,nativeName: s.nativeName })) },files,executables);
    const resource = await this.store.publish({ resourceId: `session-projection:${taskId}:${bundle.hash}`,kind: 'session-projection',contentHash: bundle.hash,relativePath,dependencies: [...new Set(skills.map(s => s.sourceResourceId))],materialize: stage => writeOwnedBundle(stage,bundle,this.store.storeId),verify: directory => { verifyOwnedBundle(directory,bundle.hash,this.store.storeId); } });
    await this.sessions.addProjectionReference(taskId,current.pointer.snapshotHash,resource.resourceId); return { resource,root };
  }
  verify(resource: ResourceRecord,snapshot: CapabilitySessionSnapshotV2): void {
    if (resource.kind !== 'session-projection' || resource.state !== 'ready' || resource.integrity !== 'valid' || resource.relativePath !== `sessions/${snapshot.taskId}/claude/plugin`) throw new ApplicationError('OWNERSHIP_CONFLICT','投影不属于此原会话');
    const manifest = verifyOwnedBundle(join(this.store.root,resource.relativePath),resource.contentHash,this.store.storeId), selectionHash = digest(canonicalJson({ ...snapshot,native: { ...snapshot.native,sessionId: null } }));
    if (manifest.metadata.taskId !== snapshot.taskId || manifest.metadata.selectionHash !== selectionHash || manifest.metadata.kind !== 'claude-session-projection') throw new ApplicationError('SNAPSHOT_IMMUTABLE','投影绑定的选择不同，不能覆盖原路径');
  }
}
