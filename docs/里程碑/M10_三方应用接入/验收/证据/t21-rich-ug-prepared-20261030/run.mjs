import {writeFileSync,existsSync} from 'node:fs';
import {DIR,SCOPE,readReviewedInputs,requirePermission} from './permission.mjs';
const args=process.argv.slice(2),reviewed=readReviewedInputs();
if(args.length===0||args.length===1&&args[0]==='--prepare'){
 console.log(JSON.stringify({status:'prepared-not-executed',scope:SCOPE,pinsSha256:reviewed.hash,maxTaskCreates:2,appStarted:false,taskCreates:0,modelListenerStarted:false,approvalPresent:existsSync(DIR+'/approval.json'),inputs:Object.keys(reviewed.pins.inputs).length}));
}else if(args.length===1&&args[0]==='--execute'){
 let permission;try{permission=requirePermission(reviewed.hash)}catch(error){console.log(JSON.stringify({status:'not-authorized-not-executed',appStarted:false,taskCreates:0,modelListenerStarted:false,error:String(error)}));process.exit(2)}
 writeFileSync(DIR+'/execution-claim.json',JSON.stringify({...permission,at:new Date().toISOString(),pid:process.pid},null,2),{flag:'wx',mode:0o600});
 const{execute}=await import('./rich-transfer.mjs');await execute(reviewed.pins,permission);
}else throw Error('UG only --prepare or --execute supported');
