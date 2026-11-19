import {modelRequest as oldReq,known,model,newPrompt} from '/private/tmp/willyou-m14-stage6.WRvdST/g04/prep-a05-cold-resume/contract.mjs';
import {modelRequest as newReq} from '/private/tmp/willyou-m14-stage6.WRvdST/g04/prep-a05-cold-resume-2/contract.mjs';
const p=newPrompt('b1'.repeat(16));
const m=[{role:'user',content:[{type:'text',text:'first'}]},{role:'system',content:[{type:'text',text:'# Environment'}]},{role:'assistant',content:[{type:'text',text:known[0]}]},{role:'user',content:[{type:'text',text:'second'}]},{role:'assistant',content:[{type:'text',text:known[1]}]},{role:'user',content:[{type:'text',text:p.text}]}];
const raw=Buffer.from(JSON.stringify({model,stream:true,messages:m}));
for(const [n,f] of [['original',oldReq],['fixed',newReq]]){try{f(raw,p);console.log(n,'accepts')}catch(e){console.log(n,'rejects:',e.message.split('\n')[0])}}
