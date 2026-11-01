import {z} from 'zod';
import {basename,dirname} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import type {OwnedBundleManifest} from './owned-bundle';
import {canonicalJson,digest} from './manifest';
const source=z.object({resourceId:z.string().min(1).max(512),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),nativeName:z.string().min(1).max(64)}).strict();
const common={kind:z.literal('claude-session-projection'),taskId:z.string().min(1).max(128),selectionHash:z.string().regex(/^[a-f0-9]{64}$/),sources:z.array(source).max(4096)};
const metadata=z.discriminatedUnion('formatVersion',[
 z.object({...common,formatVersion:z.literal(1)}).strict(),
 z.object({...common,formatVersion:z.literal(2),standardSkillScope:z.array(z.string().min(1).max(4096)).max(4096)}).strict(),
]);
/** Loading scope only: never rewrites S, grants tools, or accepts foreign paths. */
export function selectedStandardSkills(snapshot:CapabilitySessionSnapshot,scope?:readonly string[]){
 const selected=snapshot.standardSkills.filter(s=>scope===undefined||scope.includes(s.projectionPath));
 if(scope&&(snapshot.legacyBinding||new Set(scope).size!==scope.length||selected.length!==scope.length||canonicalJson(selected.map(s=>s.projectionPath))!==canonicalJson(scope)))throw new ApplicationError('INVALID_INPUT','标准Skill加载范围必须是原固定选择的有序子集');
 return selected;
}
/** Verify complete App Skill groups and explicit standard subset against full S.
 * Also reject hidden/extraneous files because Claude discovers the physical tree. */
export function claudeProjectionSelection(manifest:OwnedBundleManifest,snapshot:CapabilitySessionSnapshot,requireFull=false):{appIds:string[];standardSkillScope:string[]}{
 const fail=()=>new ApplicationError('SNAPSHOT_IMMUTABLE','Claude投影必须对应原选择及明确的完整加载范围');
 if(snapshot.runner!=='claude-code'||snapshot.provenance!=='created'||snapshot.legacyBinding)throw fail();
 const parsed=metadata.safeParse(manifest.metadata),selectionHash=digest(canonicalJson({...snapshot,native:{...snapshot.native,sessionId:null}}));
 if(!parsed.success||parsed.data.taskId!==snapshot.taskId||parsed.data.selectionHash!==selectionHash)throw fail();
 const value=parsed.data,standards=selectedStandardSkills(snapshot,value.formatVersion===2?value.standardSkillScope:undefined),appSources=(p:CapabilitySessionSnapshot['packages'][number])=>p.skills.map(s=>({resourceId:'app:'+p.packageHash,sourceHash:s.contentHash,nativeName:s.nativeName}));
 const appIds=snapshot.packages.filter(p=>appSources(p).some(source=>value.sources.some(s=>canonicalJson(s)===canonicalJson(source)))).map(p=>p.appId);
 const expected=[...snapshot.packages.filter(p=>appIds.includes(p.appId)).flatMap(appSources),...standards.map(s=>({resourceId:`standard-skill:${s.skillId}:${s.hash}`,sourceHash:s.hash,nativeName:basename(dirname(s.projectionPath))}))];
 if(canonicalJson(value.sources)!==canonicalJson(expected)||requireFull&&(appIds.length!==snapshot.packages.length||standards.length!==snapshot.standardSkills.length))throw fail();
 const names=expected.map(s=>s.nativeName);
 if(new Set(names).size!==names.length||manifest.files.some(f=>f.path!=='.claude-plugin/plugin.json'&&!names.some(name=>f.path.startsWith(`skills/${name}/`)))||names.some(name=>!manifest.files.some(f=>f.path===`skills/${name}/SKILL.md`)))throw fail();
 return{appIds,standardSkillScope:standards.map(s=>s.projectionPath)};
}
