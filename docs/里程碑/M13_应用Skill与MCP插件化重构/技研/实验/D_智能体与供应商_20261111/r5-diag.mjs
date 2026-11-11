// 归档说明：SMG 内网地址不入库（用户 2026-11-11 决定），已替换为占位 <SMG 内网地址>；运行时使用实际地址。
// 补验 D · R5 诊断：原始测试误报原因（deepseek-v4-flash-0731）。Key 只从环境变量读取。
const KEY=process.env.SMG_KEY,U='http://<SMG 内网地址>/v1/messages',H={'content-type':'application/json',authorization:'Bearer '+KEY,'anthropic-version':'2023-06-01'};
const tool={name:'wy_ping',description:'Connectivity check.',input_schema:{type:'object',properties:{}}};
const base=m=>({model:m,max_tokens:64,messages:[{role:'user',content:'Call the wy_ping tool.'}]});
const variants={'强制调用工具＋流式（原型现用）':m=>({...base(m),stream:true,tools:[tool],tool_choice:{type:'tool',name:'wy_ping'}}),'强制调用工具＋流式（重复一次）':m=>({...base(m),stream:true,tools:[tool],tool_choice:{type:'tool',name:'wy_ping'}}),'自动选择工具＋流式':m=>({...base(m),stream:true,tools:[tool],tool_choice:{type:'auto'}}),'tool_choice=any＋流式':m=>({...base(m),stream:true,tools:[tool],tool_choice:{type:'any'}}),'不带工具＋流式':m=>({...base(m),stream:true})};
const out=[];for(const m of (process.env.MODELS||'deepseek-v4-flash-0731,deepseek-v4-pro-0813').split(','))for(const [k,f] of Object.entries(variants)){const t=Date.now();let r,s;try{r=await fetch(U,{method:'POST',headers:H,body:JSON.stringify(f(m)),signal:AbortSignal.timeout(60000)});s=await r.text();}catch(e){out.push({model:m,variant:k,error:e.message,ms:Date.now()-t});continue;}
 out.push({model:m,variant:k,status:r.status,ms:Date.now()-t,toolUse:/"type"\s*:\s*"tool_use"/.test(s),text:/text_delta/.test(s),error:r.ok?null:s.slice(0,160)});}
const j=JSON.stringify(out,null,1);if(j.includes(KEY))throw new Error('leak');console.log(j);
