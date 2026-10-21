import { randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { applicationNativeSkillName, type CapabilitySessionSnapshotV2 } from '@shared/application-session';
import type { AgentLoadRequest } from '@shared/agent-adapters';
import { canonicalJson, compareCodePoints, digest } from './manifest';
import { ensureStoreDirectory, verifyPackageTree } from './package-files';
import { ownedBundle, verifyOwnedBundle, writeOwnedBundle, type OwnedBundle } from './owned-bundle';
import type { ProcessIdentity, ProcessIdentityReader } from './process-identity';
import type { ResourceRecord, ResourceStore } from './resource-store';
import type { OwnedCapabilityRun } from './run-registry';
import { withResourceLock } from './resource-lock';
import { withDiscoveryLock } from './discovery-catalog-lock';
import { LegacyCapabilityResourceAdopter,readLegacyOwnedTree } from './legacy-resource-adopter';
import {writeOwnedTree} from '../capabilities/files';
import {treeHash} from '../capabilities/assets';
import {verifyLegacyDiscoveryEntry,assertDiscoveryPath} from './legacy-discovery';
import { PackageRegistry } from './package-registry';
import { applicationSkillContentHash } from './session-registry';
import { projectSkillName, standardNativeSkillName } from './session-projector';
const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.uuid(), name = z.string().max(128).regex(/^smartdd-[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ownerSchema = z.object({ storeId: uuid, uFingerprint: hash, instanceId: uuid, pid: z.number().int().positive(), startedAt: z.string().min(1).max(128) }).strict();
const entrySchema = z.object({ resourceId: z.string().regex(/^h-projection:[a-f0-9]{64}$/), storeId: uuid, path: z.string().min(1).max(4096), nativeName: name, sourceHash: hash, projectionHash: hash,format:z.literal('legacy-tree-v1').optional() }).strict().refine(e=>e.format?e.projectionHash===e.sourceHash&&/^smartdd-[a-z][a-z0-9-]{0,63}-[a-f0-9]{16}$/.test(e.nativeName)&&e.nativeName.endsWith('-'+e.sourceHash.slice(0,16)):/^smartdd-[as]-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.nativeName)&&e.nativeName.length<=64,'共享目录格式、名称或摘要不同');
const catalogSchema = z.object({ schema: z.literal(1), homeId: hash, generation: hash, entries: z.array(entrySchema).max(4096) }).strict();
const consumerSchema = z.object({ schema: z.literal(1), consumerId: uuid, runId: uuid, ptyId: uuid, homeId: hash, generation: hash, runner: z.enum(['claude-code', 'codex']), phase: z.enum(['preparing', 'active', 'releasing']), owner: ownerSchema }).strict();
const pendingSchema = z.object({ schema: z.literal(1), operationId: uuid, token: uuid, homeId: hash, owner: ownerSchema, baseGeneration: hash, baseEntries: z.array(entrySchema).max(4096), entries: z.array(entrySchema).min(1).max(4096), phase: z.enum(['waiting', 'materializing', 'publishing', 'catalog-published']) }).strict();
type Catalog = z.infer<typeof catalogSchema>;
type Consumer = z.infer<typeof consumerSchema>;
type Pending = z.infer<typeof pendingSchema>;
type Entry = z.infer<typeof entrySchema>;
export interface DiscoveryProjectionSource {
    format?: 'legacy-tree-v1';
    nativeName: string;
    sourceHash: string;
    sourceResourceId: string;
    files: Readonly<Record<string, Uint8Array>>;
    executables: ReadonlySet<string>;
}
interface Planned {
    entry: Entry;
    relativePath: string;
    source: DiscoveryProjectionSource;
    hash: string;
    files: Readonly<Record<string,Uint8Array>>;
    bundle: OwnedBundle | null;
}
export interface DiscoveryReservation {
    run: OwnedCapabilityRun;
    catalog: NonNullable<AgentLoadRequest['catalog']>;
    activate(): Promise<void>;
    release(): Promise<void>;
}
export type DiscoveryCheckpoint = 'registered' | 'materialized' | 'renamed' | 'catalog-published';
const timestamp = () => new Date().toISOString();
const present = (path: string): boolean => { try {
    lstatSync(path);
    return true;
}
catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return false;
    throw error;
} };
const durableDirectory = (path: string) => { const fd = openSync(path, constants.O_RDONLY); try {
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} };
function jsonFile<T>(path: string, schema: z.ZodType<T>): T { try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024)
        throw new Error();
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
catch {
    throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '发现目录协调记录缺失、链接或格式损坏，保留现场');
} }
function atomicJson(path: string, value: unknown): void { const temp = join(dirname(path), '.write-' + randomUUID()); try {
    writeFileSync(temp, canonicalJson(value) + '\n', { flag: 'wx', mode: 0o600 });
    const fd = openSync(temp, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    if (present(path)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
            throw new ApplicationError('OWNERSHIP_CONFLICT', '协调文件被其他内容占用');
    }
    renameSync(temp, path);
    durableDirectory(dirname(path));
}
finally {
    if (present(temp))
        unlinkSync(temp);
} }
/** H is shared; only this store's C database is touched. No implicit homedir or foreign-store cleanup. */
export class DiscoveryCatalog {
    readonly home: string;
    readonly homeId: string;
    readonly root: string;
    readonly instanceId: string;
    readonly host: ProcessIdentity;
    private readonly owner: z.infer<typeof ownerSchema>;
    private readonly active = new Set<string>();
    constructor(readonly store: ResourceStore, home: string, private readonly processes: ProcessIdentityReader, options: {
        instanceId?: string;
        checkpoint?: (phase: DiscoveryCheckpoint) => void;
    } = {}) {
        this.home = realpathSync(home);
        this.homeId = digest(this.home);
        this.instanceId = options.instanceId ?? randomUUID();
        this.checkpoint = options.checkpoint;
        const host = processes.read(process.pid);
        if (!host || host.pid !== process.pid)
            throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '无法核验发现目录持有者');
        this.host = { ...host };
        this.owner = ownerSchema.parse({ storeId: store.storeId, uFingerprint: digest(dirname(store.root)), instanceId: this.instanceId, ...host });
        const runtime = join(this.home, '.agents/smartdd-runtime');
        if (present(runtime) && !present(join(runtime, '.willyou-catalog-root.json')) && readdirSync(runtime).length)
            throw new ApplicationError('OWNERSHIP_CONFLICT', '发现协调目录已有未识别内容');
        this.root = ensureStoreDirectory(this.home, '.agents/smartdd-runtime');
        const marker = join(this.root, '.willyou-catalog-root.json');
        try {
            writeFileSync(marker, canonicalJson({ schema: 1, owner: 'SmartDD', homeId: this.homeId, initialized: false }) + '\n', { flag: 'wx', mode: 0o600 });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
        }
        const identity = jsonFile(marker, z.object({ schema: z.literal(1), owner: z.literal('SmartDD'), homeId: hash, initialized: z.boolean() }).strict());
        if (identity.homeId !== this.homeId)
            throw new ApplicationError('OWNERSHIP_CONFLICT', '发现协调目录与实际HOME不同');
        ensureStoreDirectory(this.root, 'catalog-consumers');
        ensureStoreDirectory(this.root, 'staging');
    }
    private readonly checkpoint?: (phase: DiscoveryCheckpoint) => void;
    private lock<T>(action: () => T | Promise<T>, signal?: AbortSignal): Promise<T> { return withDiscoveryLock(this.root, this.host, action, { signal }); }
    private generation(entries: Entry[]): string { return digest(canonicalJson({ homeId: this.homeId, entries })); }
    private catalog(): Catalog {
        const path = join(this.root, 'catalog.json'), markerPath = join(this.root, '.willyou-catalog-root.json'), marker = jsonFile(markerPath, z.object({ schema: z.literal(1), owner: z.literal('SmartDD'), homeId: hash, initialized: z.boolean() }).strict());
        if (!present(path)) {
            if (marker.initialized)
                throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '已初始化的共享清单缺失，不能重建为空目录');
            const entries: Entry[] = [];
            const fresh: Catalog = { schema: 1, homeId: this.homeId, entries, generation: this.generation(entries) };
            atomicJson(path, fresh);
            atomicJson(markerPath, { ...marker, initialized: true });
            return fresh;
        }
        const value = jsonFile(path, catalogSchema);
        if (value.homeId !== this.homeId || value.generation !== this.generation(value.entries) || new Set(value.entries.map(e => e.nativeName)).size !== value.entries.length || value.entries.some(e => e.path !== join(this.home, '.agents/skills', e.nativeName, 'SKILL.md')))
            throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享目录清单、路径或代次不同');
        if (!marker.initialized)
            atomicJson(markerPath, { ...marker, initialized: true });
        return value;
    }
    private pending(): Pending | null { const path = join(this.root, 'pending.json'); if (!present(path))
        return null; const value = jsonFile(path, pendingSchema); if (value.homeId !== this.homeId || value.baseGeneration !== this.generation(value.baseEntries))
        throw new ApplicationError('OWNERSHIP_CONFLICT', '共享目录维护意图属于其他根或原集合不同'); return value; }
    private consumers(): Consumer[] { return readdirSync(join(this.root, 'catalog-consumers')).map(file => { if (!/^[a-f0-9-]{36}-[a-f0-9-]{36}\.json$/.test(file))
        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享目录有未知消费者记录'); const value = jsonFile(join(this.root, 'catalog-consumers', file), consumerSchema); if (value.homeId !== this.homeId || file !== this.consumerName(value))
        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享目录消费者身份不同'); return value; }); }
    private consumerName(c: Consumer): string { return c.owner.storeId + '-' + c.runId + '.json'; }
    async snapshot(): Promise<NonNullable<AgentLoadRequest['catalog']>> { return this.lock(() => { const c = this.catalog(); return structuredClone({ generation: c.generation, entries: c.entries }); }); }
    verify(snapshot: NonNullable<AgentLoadRequest['catalog']>): void {
        const parsed = catalogSchema.parse({ schema: 1, homeId: this.homeId, ...snapshot });
        if (parsed.generation !== this.generation(parsed.entries))
            throw new ApplicationError('HASH_MISMATCH', '共享目录集合摘要不同');
        for (const entry of parsed.entries) {
            if (entry.path !== join(this.home, '.agents/skills', entry.nativeName, 'SKILL.md'))
                throw new ApplicationError('OWNERSHIP_CONFLICT', '投影越过实际发现根');
            if(entry.format==='legacy-tree-v1'){
                const identity=verifyLegacyDiscoveryEntry(entry,this.home);
                if(entry.storeId===this.store.storeId){const r=this.store.get(entry.resourceId),deps=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(r.resourceId) as {dependency_id:string}[]).map(d=>d.dependency_id),source=this.store.get(identity.sourceResourceId);
                    if(r.kind!=='legacy-agent-projection'||r.pathScope!=='H'||r.scopeIdentity!==this.homeId||r.contentHash!==entry.projectionHash||r.state!=='ready'||r.integrity!=='valid'||this.store.directory(r)!==dirname(entry.path)||canonicalJson(deps)!==canonicalJson([identity.sourceResourceId])||source.state!=='ready'||source.integrity!=='valid'||source.pathScope!=='C'||canonicalJson({...readLegacyOwnedTree(this.store.directory(source),source.contentHash)})!==canonicalJson({...identity.files}))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原H投影本机记录或原来源不完整');}
                continue;
            }
            assertDiscoveryPath(this.home,entry.path);
            const manifest = verifyOwnedBundle(dirname(entry.path), entry.projectionHash, entry.storeId);
            if (manifest.metadata.kind !== 'codex-agent-projection-v1' || manifest.metadata.homeId !== this.homeId || manifest.metadata.nativeName !== entry.nativeName || manifest.metadata.sourceHash !== entry.sourceHash)
                throw new ApplicationError('HASH_MISMATCH', '共享投影的原始身份不同');
            if (entry.storeId === this.store.storeId) {
                const r = this.store.get(entry.resourceId), dependencies = (this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(r.resourceId) as {
                    dependency_id: string;
                }[]).map(d => d.dependency_id);
                if (r.pathScope !== 'H' || r.scopeIdentity !== this.homeId || r.contentHash !== entry.projectionHash || r.state !== 'ready' || r.integrity !== 'valid' || this.store.directory(r) !== dirname(entry.path) || canonicalJson(dependencies) !== canonicalJson([manifest.metadata.sourceResourceId]))
                    throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享投影权威记录或原依赖缺失');
            }
        }
    }
    private plans(sources: readonly DiscoveryProjectionSource[]): Planned[] {
        if (sources.length > 4096 || new Set(sources.map(s => s.nativeName)).size !== sources.length)
            throw new ApplicationError('INVALID_INPUT', '共享投影重复或超过预算');
        return sources.map(source => {
            name.parse(source.nativeName);
            hash.parse(source.sourceHash);
            if(source.format==='legacy-tree-v1'){
                const skillId=source.sourceResourceId.slice('standard-skill:'.length).split(':')[0],expected=`smartdd-${skillId}-${source.sourceHash.slice(0,16)}`,files=Object.fromEntries(Object.entries(source.files).map(([p,b])=>[p,Buffer.from(b).toString('utf8')]));
                if(!/^[a-z][a-z0-9-]{0,63}$/.test(skillId)||source.sourceResourceId!==`standard-skill:${skillId}:${source.sourceHash}`||source.nativeName!==expected||source.executables.size||treeHash(files)!==source.sourceHash||Object.entries(files).some(([p,t])=>!Buffer.from(t).equals(Buffer.from(source.files[p]))))throw new ApplicationError('HASH_MISMATCH','原H投影必须沿用完整原标准Skill和名称');
                const relativePath='.agents/skills/'+expected,entry:Entry={resourceId:'h-projection:'+digest(canonicalJson({homeId:this.homeId,storeId:this.store.storeId,nativeName:expected,hash:source.sourceHash})),storeId:this.store.storeId,path:join(this.home,relativePath,'SKILL.md'),nativeName:expected,sourceHash:source.sourceHash,projectionHash:source.sourceHash,format:'legacy-tree-v1'};return{entry,relativePath,source,hash:source.sourceHash,files:source.files,bundle:null};
            }
            if(!/^smartdd-[as]-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.nativeName)||source.nativeName.length>64)throw new ApplicationError('INVALID_INPUT','新格式投影名称无效');
            const bundle = ownedBundle({ kind: 'codex-agent-projection-v1', homeId: this.homeId, nativeName: source.nativeName, sourceHash: source.sourceHash, sourceResourceId: source.sourceResourceId }, source.files, source.executables), relativePath = '.agents/skills/' + source.nativeName;
            const entry: Entry = { resourceId: 'h-projection:' + digest(canonicalJson({ homeId: this.homeId, storeId: this.store.storeId, nativeName: source.nativeName, hash: bundle.hash })), storeId: this.store.storeId, path: join(this.home, relativePath, 'SKILL.md'), nativeName: source.nativeName, sourceHash: source.sourceHash, projectionHash: bundle.hash };
            return { entry, relativePath, source, hash:bundle.hash,files:bundle.files,bundle };
        }).sort((a, b) => compareCodePoints(a.entry.nativeName, b.entry.nativeName));
    }
    private verifySource(plan: Planned): void {
        const resource = this.store.get(plan.source.sourceResourceId);
        if (resource.pathScope !== 'C' || resource.state !== 'ready' || resource.integrity !== 'valid')
            throw new ApplicationError('RESOURCE_STATE_CHANGED', '共享投影原资源尚未就绪');
        if(plan.entry.format==='legacy-tree-v1'){
            const original=new LegacyCapabilityResourceAdopter(this.store).verify(resource);
            if(resource.kind!=='standard-skill'||resource.contentHash!==plan.hash||canonicalJson(Object.keys(original).sort())!==canonicalJson(Object.keys(plan.files).sort())||Object.entries(original).some(([p,t])=>!Buffer.from(t).equals(Buffer.from(plan.files[p]))))throw new ApplicationError('HASH_MISMATCH','原H内容与本机完整来源不同');return;
        }
        let files: Record<string, Buffer> = {}, executables = new Set<string>();
        if (resource.kind === 'standard-skill') {
            const skillId = resource.resourceId.slice('standard-skill:'.length).split(':')[0];
            if (plan.entry.nativeName !== standardNativeSkillName(skillId, resource.contentHash) || plan.entry.sourceHash !== resource.contentHash)
                throw new ApplicationError('HASH_MISMATCH', '标准Skill来源身份不同');
            files = Object.fromEntries(Object.entries(new LegacyCapabilityResourceAdopter(this.store).verify(resource)).map(([n, t]) => [n, Buffer.from(t)]));
        }
        else if (resource.kind === 'application-package') {
            const pkg = new PackageRegistry(this.store, 'discovery-reader').get(resource.contentHash);
            verifyPackageTree(this.store.directory(resource), pkg, this.store.storeId);
            const skill = pkg.manifest.skills.find(s => applicationNativeSkillName(pkg.appId, s.id, pkg.packageHash) === plan.entry.nativeName);
            if (!skill || applicationSkillContentHash(pkg.manifest, skill.path) !== plan.entry.sourceHash)
                throw new ApplicationError('HASH_MISMATCH', '应用Skill来源身份不同');
            const prefix = skill.path + '/';
            for (const f of pkg.manifest.files.filter(f => f.path.startsWith(prefix))) {
                const n = f.path.slice(prefix.length);
                files[n] = readFileSync(join(this.store.directory(resource), f.path));
                if (f.executable)
                    executables.add(n);
            }
        }
        else
            throw new ApplicationError('INVALID_PACKAGE', '不支持的共享投影来源');
        if (!files['SKILL.md'])
            throw new ApplicationError('INVALID_PACKAGE', '原Skill入口缺失');
        files['SKILL.md'] = projectSkillName(files['SKILL.md'], plan.entry.nativeName);
        if (canonicalJson(Object.keys(files).sort()) !== canonicalJson(Object.keys(plan.files).sort()) || Object.keys(files).some(n => !files[n].equals(plan.files[n])) || canonicalJson([...executables].sort()) !== canonicalJson([...plan.source.executables].sort()))
            throw new ApplicationError('HASH_MISMATCH', '共享投影不是原Skill完整内容');
    }
    private verifyProjection(plan:Planned,path:string):void{
        assertDiscoveryPath(this.home,path);
        if(plan.entry.format==='legacy-tree-v1'){const files=readLegacyOwnedTree(path,plan.hash);if(canonicalJson(Object.keys(files).sort())!==canonicalJson(Object.keys(plan.files).sort())||Object.entries(files).some(([p,t])=>!Buffer.from(t).equals(Buffer.from(plan.files[p]))))throw new ApplicationError('HASH_MISMATCH','原H静态内容不同');}
        else verifyOwnedBundle(path,plan.hash,this.store.storeId);
    }
    private writeProjection(plan:Planned,path:string):void{
        if(plan.bundle)writeOwnedBundle(path,plan.bundle,this.store.storeId);
        else writeOwnedTree(path,Object.fromEntries(Object.entries(plan.files).map(([p,b])=>[p,Buffer.from(b).toString('utf8')])),join(this.root,'staging-conflicts'));
    }
    private async register(plans: Planned[], pending: Pending): Promise<void> {
        await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
            const oldHome = this.store.sqlite.prepare('SELECT canonical_home AS home FROM capability_discovery_roots WHERE home_id=?').get(this.homeId) as {
                home: string;
            } | undefined;
            if (oldHome && oldHome.home !== this.home)
                throw new ApplicationError('OWNERSHIP_CONFLICT', '发现根登记冲突');
            this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_discovery_roots VALUES(?,?)').run(this.homeId, this.home);
            const now = timestamp();
            this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'publish-H',?,'preparing',?,?,?) ON CONFLICT(operation_id) DO UPDATE SET plan_json=excluded.plan_json,updated_at=excluded.updated_at WHERE capability_resource_operations.owner_store_id=excluded.owner_store_id").run(pending.operationId, this.store.storeId, canonicalJson(pending), now, now);
            for (const p of plans) {
                const source = this.store.get(p.source.sourceResourceId);
                if (source.state !== 'ready' || source.integrity !== 'valid' || source.pathScope !== 'C')
                    throw new ApplicationError('RESOURCE_STATE_CHANGED', '原投影依赖不可用');
                const old = this.store.sqlite.prepare('SELECT resource_id FROM capability_resources WHERE resource_id=?').get(p.entry.resourceId);
                if (old) {
                    const r = this.store.get(p.entry.resourceId);
                    if (r.pathScope !== 'H' || r.scopeIdentity !== this.homeId || r.relativePath !== p.relativePath || r.contentHash !== p.hash)
                        throw new ApplicationError('OWNERSHIP_CONFLICT', '共享投影资源记录身份不同');
                    if(p.entry.format==='legacy-tree-v1'){const deps=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(r.resourceId) as {dependency_id:string}[]).map(d=>d.dependency_id);
                        if(r.kind!=='legacy-agent-projection'||r.ownerStoreId!==this.store.storeId||canonicalJson(deps)!==canonicalJson([source.resourceId]))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原H登记或依赖缺失，不重新签认');}
                    if(p.entry.format==='legacy-tree-v1'&&r.state==='ready'&&!present(dirname(p.entry.path))){
                        if(this.store.sqlite.prepare("SELECT 1 FROM capability_resource_leases l WHERE l.state<>'released' AND (l.resource_id=? OR EXISTS(SELECT 1 FROM capability_lease_resources lr WHERE lr.lease_id=l.lease_id AND lr.resource_id=?)) LIMIT 1").get(r.resourceId,r.resourceId))throw new ApplicationError('RESOURCE_BUSY','原H路径仍有未知或活动占用');
                        this.store.sqlite.prepare("UPDATE capability_resources SET state='staged',integrity='unknown',operation_id=?,generation=generation+1 WHERE resource_id=?").run(pending.operationId,r.resourceId);
                    }
                    if (r.state !== 'ready' && r.operationId !== pending.operationId) {
                        const prior = this.store.sqlite.prepare('SELECT state FROM capability_resource_operations WHERE operation_id=?').get(r.operationId) as {
                            state: string;
                        } | undefined;
                        if (prior?.state !== 'canceled')
                            throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '原共享投影发布尚未恢复');
                        this.store.sqlite.prepare("UPDATE capability_resources SET state='staged',integrity='unknown',operation_id=? WHERE resource_id=?").run(pending.operationId, r.resourceId);
                    }
                }
                else
                    this.store.sqlite.prepare("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,scope_identity,scope_relative_path,state,generation,integrity,operation_id) VALUES(?,?,?,?,'H',?,?,?,'staged',1,'unknown',?)").run(p.entry.resourceId,p.entry.format?'legacy-agent-projection':'agent-projection', p.hash, this.store.storeId, 'H/' + this.homeId + '/' + p.relativePath + '/' + p.hash, this.homeId, p.relativePath, pending.operationId);
                this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_resource_dependencies VALUES(?,?)').run(p.entry.resourceId, source.resourceId);
                const leaseId = digest(pending.operationId + ':' + p.entry.resourceId);
                this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'install',?,?,?,?,'active',?) ON CONFLICT(lease_id) DO UPDATE SET state='active',host_instance_id=excluded.host_instance_id,pid=excluded.pid,process_started_at=excluded.process_started_at,ended_at=NULL").run(leaseId, p.entry.resourceId, pending.operationId, this.instanceId, this.host.pid, this.host.startedAt, now);
                const dependencies = this.store.sqlite.prepare('WITH RECURSIVE needed(id) AS (VALUES(?) UNION SELECT d.dependency_id FROM capability_resource_dependencies d JOIN needed n ON d.resource_id=n.id) SELECT id FROM needed').all(source.resourceId) as {
                    id: string;
                }[];
                if (dependencies.length > 10000)
                    throw new ApplicationError('INVALID_PACKAGE', '原依赖闭包超过预算');
                for (const id of [p.entry.resourceId, ...dependencies.map(d => d.id)]) {
                    const r = this.store.get(id);
                    if (id !== p.entry.resourceId && (r.state !== 'ready' || r.integrity !== 'valid'))
                        throw new ApplicationError('RESOURCE_STATE_CHANGED', '原依赖闭包未就绪');
                    this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_lease_resources VALUES(?,?,?,?)').run(leaseId, id, r.contentHash, r.generation);
                }
            }
        }).immediate());
    }
    private mine(pending: Pending): void { const current = this.pending(); if (!current || current.operationId !== pending.operationId || current.token !== pending.token || canonicalJson(current.owner) !== canonicalJson(this.owner) || canonicalJson(current) !== canonicalJson(pending))
        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享目录维护所有权已改变'); }
    private async phase(pending: Pending, phase: Pending['phase']): Promise<void> { await this.lock(() => { this.mine(pending); pending.phase = phase; atomicJson(join(this.root, 'pending.json'), pending); }); }
    private async finishRecords(pending: Pending, state: 'ready' | 'recovery-required' | 'removed', operationState: string,verify?:()=>void): Promise<void> { await withResourceLock(this.store.root, () => {verify?.();return this.store.sqlite.transaction(() => { for (const entry of pending.entries)
        this.store.sqlite.prepare('UPDATE capability_resources SET state=?,integrity=? WHERE resource_id=? AND operation_id=?').run(state, state === 'ready' ? 'valid' : state === 'removed' ? 'invalid' : 'unknown', entry.resourceId, pending.operationId); this.store.sqlite.prepare('UPDATE capability_resource_operations SET state=?,updated_at=? WHERE operation_id=? AND owner_store_id=?').run(operationState, timestamp(), pending.operationId, this.store.storeId); this.store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE owner_id=? AND owner_kind='install'").run(timestamp(), pending.operationId); }).immediate();}); }
    async publish(sources: readonly DiscoveryProjectionSource[], options: {
        signal?: AbortSignal;
        waitMs?: number;
    } = {}): Promise<NonNullable<AgentLoadRequest['catalog']>> { return this.publication(this.plans(sources), options); }
    async recover(operationId: string, sources: readonly DiscoveryProjectionSource[], options: {
        signal?: AbortSignal;
        waitMs?: number;
    } = {}): Promise<NonNullable<AgentLoadRequest['catalog']>> { uuid.parse(operationId); return this.publication(this.plans(sources), options, operationId); }
    private async publication(plans: Planned[], options: {
        signal?: AbortSignal;
        waitMs?: number;
    }, recoverId?: string): Promise<NonNullable<AgentLoadRequest['catalog']>> {
        let pending: Pending | undefined, reuse = false;
        const operationId = recoverId ?? randomUUID();
        if (this.active.has(operationId))
            throw new ApplicationError('RESOURCE_BUSY', '共享目录原操作仍在执行');
        this.active.add(operationId);
        try {
            await this.lock(async () => {
                const current = this.catalog(), prior = this.pending();
                if (recoverId) {
                    if (!prior || prior.operationId !== recoverId || prior.owner.storeId !== this.store.storeId || prior.owner.uFingerprint !== this.owner.uFingerprint || canonicalJson(prior.entries) !== canonicalJson(plans.map(p => p.entry)))
                        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '缺少相同归属及内容的原维护记录');
                    const ledger = this.store.sqlite.prepare("SELECT plan_json AS plan FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=? AND kind='publish-H'").get(recoverId, this.store.storeId) as {
                        plan: string;
                    } | undefined;
                    const original = ledger ? pendingSchema.safeParse(JSON.parse(ledger.plan)) : null;
                    if (!original?.success || canonicalJson(original.data.owner) !== canonicalJson(prior.owner) || canonicalJson(original.data.entries) !== canonicalJson(prior.entries) || original.data.baseGeneration !== prior.baseGeneration || canonicalJson(original.data.baseEntries) !== canonicalJson(prior.baseEntries))
                        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '原H意图与本数据根操作账不同，保留现场');
                    if (prior.owner.instanceId !== this.instanceId && this.processes.state({ pid: prior.owner.pid, startedAt: prior.owner.startedAt }) !== 'stopped')
                        throw new ApplicationError('RESOURCE_BUSY', '原目录维护者仍存活或身份未知');
                    pending = { ...prior, token: randomUUID(), owner: this.owner };
                    atomicJson(join(this.root, 'pending.json'), pending);
                }
                else {
                    if (prior)
                        throw new ApplicationError('RESOURCE_BUSY', '共享目录有待完成维护，保留原意图');
                    for (const p of plans) {
                        const old = current.entries.find(e => e.nativeName === p.entry.nativeName);
                        if (old && canonicalJson(old) !== canonicalJson(p.entry))
                            throw new ApplicationError('OWNERSHIP_CONFLICT', '同名共享投影属于其他数据根或版本，不能改签');
                    }
                    if (plans.every(p => current.entries.some(e => canonicalJson(e) === canonicalJson(p.entry))&&!(p.entry.format==='legacy-tree-v1'&&!present(dirname(p.entry.path))))) {
                        reuse = true;
                        return;
                    }
                    pending = { schema: 1, operationId, token: randomUUID(), homeId: this.homeId, owner: this.owner, baseGeneration: current.generation, baseEntries: current.entries, entries: plans.map(p => p.entry), phase: 'waiting' };
                    atomicJson(join(this.root, 'pending.json'), pending);
                }
                await this.register(plans, pending!);
            }, options.signal);
            if (reuse) {
                const snapshot = await this.snapshot();
                this.verify(snapshot);
                for (const p of plans) {
                    this.verifySource(p);
                    const r = this.store.get(p.entry.resourceId);
                    if (r.state !== 'ready' || r.integrity !== 'valid')
                        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '原共享资源账尚未完成');
                }
                return snapshot;
            }
            const work = pending!;
            this.checkpoint?.('registered');
            const deadline = performance.now() + (options.waitMs ?? 3000);
            for (;;) {
                const waiting = await this.lock(() => { this.mine(work); return this.consumers().length > 0; });
                if (!waiting)
                    break;
                if (options.signal?.aborted || performance.now() >= deadline) {
                    await this.cancelPending(work);
                    throw new ApplicationError(options.signal?.aborted ? 'CANCELED' : 'RESOURCE_BUSY', '共享发现目录仍被运行使用，本次未发布');
                }
                await new Promise<void>(resolve => setTimeout(resolve, Math.min(20, Math.max(1, deadline - performance.now()))));
            }
            if (options.signal?.aborted) {
                await this.cancelPending(work);
                throw new ApplicationError('CANCELED', '共享目录发布前已取消');
            }
            await this.phase(work, 'materializing');
            const staging = ensureStoreDirectory(this.root, 'staging/' + operationId);
            for (const p of plans) {
                this.verifySource(p);
                const target = dirname(p.entry.path), stage = join(staging, p.entry.nativeName);
                if (present(target))
                    this.verifyProjection(p,target);
                else {
                    if (!present(stage))
                        this.writeProjection(p,stage);
                    this.verifyProjection(p,stage);
                }
            }
            this.checkpoint?.('materialized');
            if (options.signal?.aborted) {
                await this.cancelPending(work);
                throw new ApplicationError('CANCELED', '共享目录发布前已取消');
            }
            await this.lock(async () => {
                this.mine(work);
                if (options.signal?.aborted)
                    throw new ApplicationError('CANCELED', '共享目录发布前已取消');
                if (this.consumers().length)
                    throw new ApplicationError('RESOURCE_BUSY', '目录维护中出现未释放消费者');
                let current = this.catalog();
                const expectedEntries = [...work.baseEntries, ...plans.filter(p => !work.baseEntries.some(e => e.nativeName === p.entry.nativeName)).map(p => p.entry)].sort((a, b) => compareCodePoints(a.nativeName, b.nativeName));
                if (current.generation !== work.baseGeneration && current.generation !== this.generation(expectedEntries))
                    throw new ApplicationError('RESOURCE_STATE_CHANGED', '原共享目录代次已改变');
                work.phase = 'publishing';
                atomicJson(join(this.root, 'pending.json'), work);
                await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => { const protectedRows = this.store.sqlite.prepare('SELECT lr.resource_id AS id,lr.content_hash AS hash,lr.generation FROM capability_lease_resources lr JOIN capability_resource_leases l ON l.lease_id=lr.lease_id WHERE l.owner_id=?').all(operationId) as {
                    id: string;
                    hash: string;
                    generation: number;
                }[]; for (const held of protectedRows) {
                    const r = this.store.get(held.id);
                    if (r.contentHash !== held.hash || r.generation !== held.generation || ['deleting', 'removed', 'recovery-required'].includes(r.state))
                        throw new ApplicationError('RESOURCE_STATE_CHANGED', '原目录发布依赖占用已改变');
                } for (const p of plans) {
                    const r = this.store.get(p.entry.resourceId), source = this.store.get(p.source.sourceResourceId);
                    if (r.contentHash !== p.hash || ['deleting', 'removed'].includes(r.state) || source.state !== 'ready' || source.integrity !== 'valid')
                        throw new ApplicationError('RESOURCE_STATE_CHANGED', '发布前原资源状态已改变');
                    this.store.sqlite.prepare("UPDATE capability_resources SET state='verified',integrity='valid' WHERE resource_id=? AND state<>'ready'").run(r.resourceId);
                } }).immediate());
                if (options.signal?.aborted)
                    throw new ApplicationError('CANCELED', '共享目录发布前已取消');
                ensureStoreDirectory(this.home, '.agents/skills');
                for(const p of plans){this.verifySource(p);const stage=join(staging,p.entry.nativeName);if(!present(dirname(p.entry.path)))this.verifyProjection(p,stage);}
                for (const p of plans) {
                    const target = dirname(p.entry.path);
                    if (present(target))
                        this.verifyProjection(p,target);
                    else {
                        renameSync(join(staging, p.entry.nativeName), target);
                        durableDirectory(dirname(target));
                    }
                    this.checkpoint?.('renamed');
                }
                for(const p of plans){this.verifySource(p);this.verifyProjection(p,dirname(p.entry.path));}
                current = { schema: 1, homeId: this.homeId, entries: expectedEntries, generation: this.generation(expectedEntries) };
                atomicJson(join(this.root, 'catalog.json'), current);
                work.phase = 'catalog-published';
                atomicJson(join(this.root, 'pending.json'), work);
                this.checkpoint?.('catalog-published');
                await this.finishRecords(work, 'ready', 'committed',()=>{
                    this.mine(work);if(canonicalJson(this.catalog())!==canonicalJson(current))throw new ApplicationError('RESOURCE_STATE_CHANGED','最终共享目录在就绪提交前变化');
                    for(const p of plans){this.verifySource(p);this.verifyProjection(p,dirname(p.entry.path));}
                });
                unlinkSync(join(this.root, 'pending.json'));
                durableDirectory(this.root);
            });
            return this.snapshot();
        }
        finally {
            this.active.delete(operationId);
        }
    }
    async cancel(operationId: string): Promise<void> { uuid.parse(operationId); const pending = await this.lock(() => { const current = this.pending(); if (!current || current.operationId !== operationId)
        throw new ApplicationError('NOT_FOUND', '原维护意图不存在'); this.mine(current); return current; }); await this.cancelPending(pending); }
    private async cancelPending(pending: Pending): Promise<void> { await this.lock(async () => { this.mine(pending); if (!['waiting', 'materializing'].includes(pending.phase) || pending.entries.some(e => !pending.baseEntries.some(b => b.nativeName === e.nativeName) && present(dirname(e.path))))
        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '目录已开始物化，须核对原操作后恢复'); await this.finishRecords(pending, 'removed', 'canceled'); unlinkSync(join(this.root, 'pending.json')); durableDirectory(this.root); }); }
    /** Callback only reserves C refs/leases; it must not fork or perform remote work. */
    async reserveRun(generation: string, runner: 'claude-code' | 'codex', register: (ids: {
        runId: string;
        ptyId: string;
    }) => Promise<OwnedCapabilityRun>): Promise<DiscoveryReservation> {
        hash.parse(generation);
        const runId = randomUUID(), ptyId = randomUUID(), record: Consumer = { schema: 1, consumerId: randomUUID(), runId, ptyId, homeId: this.homeId, generation, runner, phase: 'preparing', owner: this.owner }, path = join(this.root, 'catalog-consumers', this.consumerName(record));
        let run!: OwnedCapabilityRun, catalog!: Catalog;
        await this.lock(async () => {
            // Persist the exact native HOME even for an empty catalog/history
            // guard, before publishing its H consumer intent.
            await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
                const known=this.store.sqlite.prepare('SELECT canonical_home AS home FROM capability_discovery_roots WHERE home_id=?').get(this.homeId) as {home:string}|undefined;
                if(known&&known.home!==this.home)throw new ApplicationError('OWNERSHIP_CONFLICT','发现根登记已属于另一目录');
                this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_discovery_roots VALUES(?,?)').run(this.homeId,this.home);
            }).immediate());
            if (this.pending())
            throw new ApplicationError('RESOURCE_BUSY', '共享目录正在维护，暂不接受新消费者'); catalog = this.catalog(); if (catalog.generation !== generation)
            throw new ApplicationError('RESOURCE_STATE_CHANGED', '共享目录代次已变化，重新准备能力'); atomicJson(path, record); try {
            run = await register({ runId, ptyId });
            if (run.runId !== runId || run.ptyId !== ptyId)
                throw new ApplicationError('NATIVE_IDENTITY_CONFLICT', '运行登记未沿用预留身份');
            this.assertRun(record, false);
        }
        catch (error) {
            if (!this.store.sqlite.prepare('SELECT 1 FROM capability_runs WHERE run_id=?').get(runId)) {
                unlinkSync(path);
                durableDirectory(dirname(path));
            }
            throw error;
        } });
        const current = () => { const c = jsonFile(path, consumerSchema); if (c.consumerId !== record.consumerId || canonicalJson(c.owner) !== canonicalJson(this.owner))
            throw new ApplicationError('OWNERSHIP_CONFLICT', '消费者已被其他实例替换'); return c; };
        return { run, catalog: { generation: catalog.generation, entries: structuredClone(catalog.entries) }, activate: () => this.lock(() => { const c = current(); this.assertRun(c, false); if (c.generation !== this.catalog().generation)
                throw new ApplicationError('RESOURCE_STATE_CHANGED', '原消费者目录代次不同'); c.phase = 'active'; atomicJson(path, c); }), release: () => this.lock(() => { const c = current(); this.assertRun(c, true); c.phase = 'releasing'; atomicJson(path, c); unlinkSync(path); durableDirectory(dirname(path)); }) };
    }
    private assertRun(c: Consumer, terminal: boolean): void { const row = this.store.sqlite.prepare('SELECT owner_pid AS pid,owner_started_at AS startedAt,owner_instance_id AS instanceId,pty_id AS ptyId,state,revocation_state AS revocation FROM capability_runs WHERE run_id=?').get(c.runId) as {
        pid: number;
        startedAt: string;
        instanceId: string;
        ptyId: string;
        state: string;
        revocation: string;
    } | undefined; if (!row || row.pid !== c.owner.pid || row.startedAt !== c.owner.startedAt || row.instanceId !== c.owner.instanceId || row.ptyId !== c.ptyId)
        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '消费者与本数据根运行身份不一致'); if (terminal) {
        const children = this.store.sqlite.prepare('SELECT state FROM capability_run_processes WHERE run_id=?').all(c.runId) as {
            state: string;
        }[];
        if (!['stopped', 'failed'].includes(row.state) || row.revocation !== 'revoked' || !children.length || children.some(p => !['exited', 'canceled'].includes(p.state)) || this.store.sqlite.prepare("SELECT 1 FROM capability_run_activities WHERE run_id=? AND state='active'").get(c.runId))
            throw new ApplicationError('RESOURCE_BUSY', 'CLI、桥或执行者尚未全部确认结束，继续保护发现目录');
    } }
    async releaseRecovered(runId: string): Promise<void> { uuid.parse(runId); await this.lock(() => { const path = join(this.root, 'catalog-consumers', this.store.storeId + '-' + runId + '.json'), c = jsonFile(path, consumerSchema); if (c.homeId !== this.homeId || c.owner.storeId !== this.store.storeId || c.owner.uFingerprint !== this.owner.uFingerprint || this.processes.state({ pid: c.owner.pid, startedAt: c.owner.startedAt }) !== 'stopped')
        throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '原消费者所有者仍存活或无法证明退出'); this.assertRun(c, true); unlinkSync(path); durableDirectory(dirname(path)); }); }
    /** Only this store's exact dead owners; no age/PID-only cleanup or foreign adoption. */
    async recoverConsumers():Promise<{runId:string;state:'released'|'retained'|'unknown'}[]>{
        return this.lock(()=>{
            const results:{runId:string;state:'released'|'retained'|'unknown'}[]=[];
            for(const c of this.consumers()){
                if(c.owner.storeId!==this.store.storeId)continue;
                if(c.owner.uFingerprint!==this.owner.uFingerprint){results.push({runId:c.runId,state:'unknown'});continue;}
                const owner=this.processes.state({pid:c.owner.pid,startedAt:c.owner.startedAt});
                if(owner!=='stopped'){results.push({runId:c.runId,state:owner==='unknown'?'unknown':'retained'});continue;}
                const row=this.store.sqlite.prepare('SELECT 1 FROM capability_runs WHERE run_id=?').get(c.runId);
                if(!row){
                    // H preparing is durable before the C-only reserve callback.
                    // No run row means that callback never committed; it cannot
                    // have handed an OS fork to the later launcher phase.
                    if(c.phase!=='preparing'){results.push({runId:c.runId,state:'unknown'});continue;}
                }else{
                    try{this.assertRun(c,true);}catch{results.push({runId:c.runId,state:'retained'});continue;}
                }
                unlinkSync(join(this.root,'catalog-consumers',this.consumerName(c)));durableDirectory(join(this.root,'catalog-consumers'));results.push({runId:c.runId,state:'released'});
            }
            return results;
        });
    }
    verifyReference(resource: ResourceRecord, snapshot: CapabilitySessionSnapshotV2): void { if (resource.kind !== 'agent-projection' || resource.pathScope !== 'H' || resource.scopeIdentity !== this.homeId || resource.state !== 'ready' || resource.integrity !== 'valid')
        throw new ApplicationError('RESOURCE_STATE_CHANGED', '共享投影资源未就绪或实际HOME不同'); const manifest = verifyOwnedBundle(this.store.directory(resource), resource.contentHash, this.store.storeId); if (manifest.metadata.homeId !== this.homeId)
        throw new ApplicationError('OWNERSHIP_CONFLICT', '共享投影属于其他发现根'); const selections = [...snapshot.packages.flatMap(p => p.skills.map(s => ({ path: s.projectionPath, hash: s.contentHash }))), ...snapshot.standardSkills.map(s => ({ path: s.projectionPath, hash: s.hash }))]; if (snapshot.runner !== 'codex' || !selections.some(s => s.path === join(this.store.directory(resource), 'SKILL.md') && s.hash === manifest.metadata.sourceHash))
        throw new ApplicationError('OWNERSHIP_CONFLICT', '共享投影未被原会话按相同来源选择'); }
}
