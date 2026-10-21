import {lstatSync,realpathSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {AgentLoadRequest} from '@shared/agent-adapters';
import {readLegacyOwnedTree} from './legacy-resource-adopter';

/** Read only: never creates parents or treats a matching prefix as ownership. */
export function assertDiscoveryPath(home:string,path:string):void{
 if(realpathSync(home)!==home||!path.startsWith(home+'/')||join(home,relative(home,path))!==path)throw new ApplicationError('OWNERSHIP_CONFLICT','发现路径不是原HOME内的规范路径');
 let at=home;
 for(const part of relative(home,path).split('/')){
  at=join(at,part);const stat=lstatSync(at);
  if(stat.isSymbolicLink())throw new ApplicationError('OWNERSHIP_CONFLICT','发现路径含链接，保留原路径');
 }
}
/** A schema1 marker has no storeId. This proves the exact legacy format/content
 * for read-only filtering; it never assigns a foreign tree to this store. */
export function verifyLegacyDiscoveryEntry(entry:NonNullable<AgentLoadRequest['catalog']>['entries'][number],home:string){
 if(entry.format!=='legacy-tree-v1'||entry.projectionHash!==entry.sourceHash||entry.path!==join(home,'.agents/skills',entry.nativeName,'SKILL.md'))throw new ApplicationError('OWNERSHIP_CONFLICT','原H目录格式、路径或摘要不同');
 const match=/^smartdd-([a-z][a-z0-9-]{0,63})-([a-f0-9]{16})$/.exec(entry.nativeName);
 if(!match||match[2]!==entry.sourceHash.slice(0,16))throw new ApplicationError('HASH_MISMATCH','原H目录名与原完整摘要不同');
 assertDiscoveryPath(home,entry.path);
 const files=readLegacyOwnedTree(dirname(entry.path),entry.projectionHash);
 return{skillId:match[1],sourceResourceId:`standard-skill:${match[1]}:${entry.sourceHash}`,files};
}
