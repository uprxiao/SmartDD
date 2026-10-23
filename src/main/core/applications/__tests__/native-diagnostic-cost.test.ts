import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import * as sessions from '../session-registry';
import {nativeCapabilityConflicts} from '../native-application-conflicts';
let root:string|undefined;
afterEach(()=>{vi.restoreAllMocks();if(root)rmSync(root,{recursive:true,force:true});root=undefined;});
describe('bounded host source attribution lookup',()=>{
 it('indexes source paths once rather than repeatedly resolving every prior native flag',()=>{
  root=mkdtempSync(join(tmpdir(),'willyou-diagnostic-cost-'));const taskId=randomUUID(),snapshot:CapabilitySessionSnapshotV2={schema:2,taskId,projectId:'p1',createdAt:new Date().toISOString(),runner:'codex',adapterBinding:{id:'codex',version:'1.0.0',hash:'a'.repeat(64),projectionFormatVersion:1,nativeToolNames:{}},native:{sessionId:null,stateRoot:root,cwd:root},agentAtCreation:{version:'0.162.1',adapterRevision:1},catalogGeneration:'b'.repeat(64),packages:[],standardSkills:[],mcp:[],provenance:'created'},flags=Array.from({length:100},(_,i)=>({path:join(root!,'user-'+i,'SKILL.md'),enabled:false})),sources=flags.map(f=>({path:f.path,configurationPath:join(root!,'config.toml'),location:'file' as const})),resolve=vi.spyOn(sessions,'canonicalFuturePath'),result=nativeCapabilityConflicts(snapshot,{command:'/usr/bin/false',version:'0.162.1',inventory:[],userSkillConfig:flags,skillConfigSources:sources});expect(resolve).toHaveBeenCalled();process.stdout.write('diagnostic_source_resolution_calls='+resolve.mock.calls.length+'\n');expect(resolve.mock.calls.length).toBeLessThan(1000);expect(result.sources.size).toBe(0);expect(result.applications.size).toBe(0);expect(result.standardSkills.size).toBe(0);expect(flags.every(f=>f.enabled===false)).toBe(true);const target=flags[0].path;const fixed={...snapshot,standardSkills:[{skillId:'sample',versionId:'sample-original',hash:'c'.repeat(64),hashAlgorithm:'legacy-tree-v1' as const,projectionPath:target}]};const first=join(root!,'first.toml'),second=join(root!,'second.toml');const same=nativeCapabilityConflicts(fixed,{command:'/usr/bin/false',version:'0.162.1',inventory:[],userSkillConfig:[flags[0]],skillConfigSources:[{path:target,configurationPath:first,location:'file'},{path:target,configurationPath:second,location:'file'}]});expect(same.sources.get('standard-skill:sample')?.[0].configurationPath).toBe(first);
 });
});
