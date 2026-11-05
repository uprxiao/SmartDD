import {join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';

/** The identity an M4 session recorded for one of its shared standard Skills (read-only, for verifying old sessions). */
export interface LegacyDiscoveryEntry {resourceId:string;storeId:string;path:string;nativeName:string;sourceHash:string;projectionHash:string;format:'legacy-tree-v1'}

export function legacyDiscoveryEntry(storeId:string,home:string,skillId:string,sourceHash:string):LegacyDiscoveryEntry{
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(skillId)||!/^[a-f0-9]{64}$/.test(sourceHash))throw new ApplicationError('INVALID_INPUT','原Skill身份或完整摘要无效');
 const nativeName=`smartdd-${skillId}-${sourceHash.slice(0,16)}`,homeId=digest(home);
 return{resourceId:'h-projection:'+digest(canonicalJson({homeId,storeId,nativeName,hash:sourceHash})),storeId,path:join(home,'.agents/skills',nativeName,'SKILL.md'),nativeName,sourceHash,projectionHash:sourceHash,format:'legacy-tree-v1'};
}
