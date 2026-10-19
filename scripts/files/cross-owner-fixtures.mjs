import {randomUUID} from 'node:crypto';
/** Valid payloads whose only invalid component is a peer-issued capability. */
export function crossOwnerRequests(peer,ownRoot){
 const path={...peer.root,relativePath:'value.txt'},save={ref:peer.ref,opId:randomUUID(),bufferVersion:2,baseHash:peer.hash,base64:Buffer.from('DENIED PEER SAVE\r\n').toString('base64')};
 return[
  ['list',[{...peer.root,relativePath:''}]],['open',[path]],['read',[peer.ref]],['refresh',[peer.ref]],
  ['chunk',[peer.ref,0,1,peer.hash,randomUUID()]],['save',[save]],
  ['checkpoint',[{ref:peer.ref,draftId:randomUUID(),bufferVersion:2,baseHash:peer.hash,base64:save.base64,encoding:'utf-8',bom:false}]],
  ['drafts',[peer.ref]],['readDraft',[peer.ref,peer.draftId]],
  ['resolveDraft',[{ref:peer.ref,draftId:peer.draftId,bufferVersion:peer.draftVersion,hash:peer.draftHash,action:'discard'}]],
  ['watch',[peer.root,[''],[peer.ref]]],['watch',[ownRoot,[''],[peer.ref]]],
  ['reveal',[{kind:'document',ref:peer.ref}]],['reveal',[{kind:'path',path,directory:false}]],
  ['applications',[{kind:'document',ref:peer.ref}]],['closeDocument',[peer.ref]],
 ];
}
