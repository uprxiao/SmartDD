const KEYS=['model','model_reasoning_effort'];
const readTop=t=>{const o={};for(const line of t.split('\n')){if(/^\s*\[/.test(line))break;const m=/^\s*(model|model_reasoning_effort)\s*=\s*"([^"]*)"\s*$/.exec(line);if(m)o[m[1]]=m[2];}return o;};
const setTop=(t,k,v)=>{const lines=t.split('\n');let end=lines.findIndex(l=>/^\s*\[/.test(l));if(end<0)end=lines.length;const i=lines.slice(0,end).findIndex(l=>new RegExp(`^\\s*${k}\\s*=`).test(l));
 if(v===undefined){if(i>=0)lines.splice(i,1);}else if(i>=0)lines[i]=`${k} = ${JSON.stringify(v)}`;else lines.splice(0,0,`${k} = ${JSON.stringify(v)}`);return lines.join('\n');};
// before: snapshot at launch; sessionModels: models WillYou observed in this session's turn_context
function decide(before,afterText,sessionModels){const after=readTop(afterText);const changed=KEYS.filter(k=>after[k]!==before[k]);if(!changed.length)return {action:'none'};
 if(!sessionModels.includes(after.model)&&after.model!==before.model)return {action:'no-offer',reason:'当前全局模型不是本会话用过的模型，可能是终端或其他程序修改'};return {action:'offer',changed,expect:after};}
function restore(currentText,before,expect){const cur=readTop(currentText);for(const k of KEYS)if(cur[k]!==expect[k])return {ok:false,reason:`${k} 已再次变化，放弃还原`};let t=currentText;for(const k of KEYS)t=setTop(t,k,before[k]);return {ok:true,text:t};}

const original = "model = 'user-default' # valid TOML\nmodel_reasoning_effort = \"high\"\n";
const before=readTop(original); const after=setTop(original,'model','session-model');const decision=decide(before,after,['session-model']);const result=restore(after,before,decision.expect);
console.log(JSON.stringify({original,before,after,decision,result},null,2));
