// Passive own-App observation only. Never activate/raise/click or install a guard.
export async function waitPassiveInitialFocus({read,record,check=()=>{},now=Date.now,delay=ms=>new Promise(ok=>setTimeout(ok,ms)),stableMs=3000,timeoutMs=300000}){
 if(stableMs!==3000||timeoutMs!==300000)throw Error('Original R012 passive initial focus bounds required');
 const start=now();Object.assign(record,{mode:'passive-native-dom-3s',status:'awaiting-native-dom-stable',startedAtMs:start,requiredStableMs:stableMs,timeoutMs,samples:[],stableSamples:[],resets:[],automaticActivations:0,pointerRequired:false});let stable;
 while(now()-start<timeoutMs){check();const observed=await read(),sample={atMs:now(),...observed};record.samples.push(sample);record.last=sample;record.elapsedMs=sample.atMs-start;
  if(sample.native===true&&sample.focused===true&&sample.visibility==='visible'){stable??=sample.atMs;record.stableSamples.push(sample);record.actualStableMs=sample.atMs-stable;if(record.actualStableMs>=stableMs){record.status='focused';record.stableSinceMs=stable;return record}}
  else{if(stable!==undefined)record.resets.push({atMs:sample.atMs,reason:'native-or-dom-not-focused-or-hidden'});stable=undefined;record.stableSamples=[];record.actualStableMs=0}
  await delay(250);
 }
 record.status='not-focused-stable';throw Error('Own App Native/DOM focus was not continuously observed for3000ms within300000ms');
}
