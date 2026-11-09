export async function awaitBeforeWriteKeyGate(g,family){
 if(g.keyGate?.pending)throw Error('Own synthetic key gate already pending');
 const gate={family,enteredAt:Date.now(),pending:true,released:false,boundary:'DI key-provider await before source decode completion; no OS request/30second timeout claim'};g.keyGate=gate;
 await new Promise((_resolve,reject)=>{g.rejectKeyGate=()=>{if(!gate.pending)return false;gate.pending=false;gate.released=true;gate.releasedAt=Date.now();g.rejectKeyGate=null;reject(new g.SourceError('keychain-denied','钥匙串授权被拒绝或不可用；未写入Cookie'));return true;};});
 throw Error('Synthetic key gate must reject before derivation');
}
