// Synthetic F-BUG/F-SITE factory. Pure constructors plus handler; NO listen/process/model side effects.
import { createHash, createHmac, randomBytes } from 'node:crypto';
export const demoAccounts = Object.freeze({qa:'Qa-Pass-1', qa2:'Qa2-Pass-1'});
const cases = new Set(['T120','T121','T122.missing','T122.ambiguous','T123','T124']);
const digest=x=>createHash('sha256').update(String(x)).digest('hex');
const htmlEscape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function buildScenario({caseId,marker,siteOrigin,alternativeOrigin}) {
 if (!cases.has(caseId)||!/^M12_SOP_[0-9a-f]{16}$/.test(marker)) throw new Error('Invalid synthetic scope');
 for (const origin of [siteOrigin, ...(caseId==='T122.ambiguous'?[alternativeOrigin]:[])]) if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin??'')) throw new Error('Require isolated localhost origin');
 const account=caseId==='T124'?'qa2':'qa',id=String(1200+[...cases].indexOf(caseId));
 const env=caseId==='T122.missing'?'未填写环境地址。':caseId==='T122.ambiguous'?`环境 A：${siteOrigin}/site；环境 B：${alternativeOrigin}/site。两处都被标为唯一待验环境，未说明优先级。`:`环境：${siteOrigin}/site。`;
 const credentials=`测试账号：${account}。`+(caseId==='T123'?'密码未提供，由用户手动登录。':`演示密码：${demoAccounts[account]}。`);
 const title=`${marker} ${caseId} 总价异常`;
 const steps=`${env}\n${credentials}\n版本：fixture-v1。\n步骤：登录后核对页头账号；商品单价 10.00，数量 2，点击“计算总价”。期望总价 20.00。报告现象：显示 20.01。\n本工单及账号均为本机合成验收数据，无真实业务账号。`;
 return {caseId,marker,id,title,account,siteOrigin,alternativeOrigin:caseId==='T122.ambiguous'?alternativeOrigin:null,initialBugPresent:caseId==='T120',bug:{id,title,status:'active',pri:3,severity:3,assignedTo:{account:'tester'},product:{id:'96',name:'Synthetic Product'},module:{id:'2',name:'Synthetic Cart'},os:'all',browser:'all',hardware:'all',openedBuild:'fixture-v1',steps,files:[]},actions:[{action:'opened',comment:`${marker} synthetic history; no real attachment`}]};
}
export function m10Response(scenario, method, rawUrl, tokenMatches) {
 const url=new URL(rawUrl,'http://127.0.0.1');
 if (!url.pathname.startsWith('/biz/api.php/')) return null;
 if (!['GET','HEAD'].includes(method)) return {status:405,body:{error:'SYNTHETIC_ZENTAO_WRITE_FORBIDDEN'},businessWrite:true};
 if (!tokenMatches) return {status:401,body:{error:'synthetic token required'},businessWrite:false};
 let body;
 if (url.pathname==='/biz/api.php/v1/user') body={profile:{id:'7',account:'tester'}};
 else if(url.pathname==='/biz/api.php/v1/langs') body={bug:{statusList:{active:'激活'},priList:{3:'P2'},severityList:{3:'较大'}}};
 else if(url.pathname==='/biz/api.php/v2/my/work') {
  if(url.searchParams.get('mode')!=='bug'||url.searchParams.get('type')!=='assignedTo') return {status:400,body:{error:'expected assignedTo bug scope'},businessWrite:false};
  const pageID=Number(url.searchParams.get('pageID')??1),recPerPage=Number(url.searchParams.get('recPerPage')??20);
  if(!Number.isInteger(pageID)||pageID<1||!Number.isInteger(recPerPage)||recPerPage<1||recPerPage>1000)return {status:400,body:{error:'invalid pager'},businessWrite:false};
  body={mode:'bug',type:'assignedTo',pager:{recTotal:1,pageID,recPerPage,pageTotal:1},bugs:pageID===1?[{id:scenario.id,title:scenario.title,status:'active',assignedTo:{account:'tester'}}]:[]};
 } else if(url.pathname===`/biz/api.php/v1/bugs/${scenario.id}`) body={bug:scenario.bug,actions:scenario.actions};
 else return {status:404,body:{error:'No synthetic route; inspect provider instead of pretending success'},businessWrite:false};
 return {status:200,body,businessWrite:false};
}
export function createHandler({scenario,hostOnlySyntheticToken,calculate,onRecord=()=>{}}) {
 if (!hostOnlySyntheticToken || typeof calculate!=='function') throw new Error('Explicit host-only token and calculation source required');
 const sign=value=>createHmac('sha256',hostOnlySyntheticToken).update(scenario.marker+' '+value).digest('hex');
 const readSession=cookie=>{const [who,nonce,signature,...rest]=String(cookie??'').split('.');return !rest.length&&Object.hasOwn(demoAccounts,who)&&/^[a-f0-9]{48}$/.test(nonce??'')&&signature===sign(who+'.'+nonce)?who:null;};
 return async function handler(req,res) {
  const url=new URL(req.url,'http://127.0.0.1'),method=req.method??'GET';
  let status=500,account=null,responseEvidence=null;
  const send=(s,body,type='application/json')=>{status=s;res.writeHead(s,{'content-type':type,'cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);};
  try {
   const m=m10Response(scenario,method,req.url,req.headers.token===hostOnlySyntheticToken);
   if(m){send(m.status,m.body);return;}
   const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('m12sid='))?.slice(7);account=readSession(cookie);
   if(url.pathname==='/health'){send(200,{marker:scenario.marker,version:calculate(10,2)===20?'fixture-fixed':'fixture-v1'});return;}
   if(url.pathname==='/site/login'&&method==='POST') {
    let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw new Error('bounded login');}
    const form=new URLSearchParams(text),candidate=form.get('account'),password=form.get('password');
    if(demoAccounts[candidate]!==password){send(403,'Login failed','text/plain');return;}
    const value=candidate+'.'+randomBytes(24).toString('hex'),sid=value+'.'+sign(value);account=candidate;
    // Deliberately do not log body, password, cookie, token, or sid.
    res.setHeader('set-cookie',`m12sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);status=303;res.writeHead(303,{location:'/site'});res.end();return;
   }
   if(url.pathname==='/site/api/total') {if(!account){send(401,{error:'login required'});return;}responseEvidence={marker:scenario.marker,account,total:calculate(10,2).toFixed(2),version:calculate(10,2)===20?'fixture-fixed':'fixture-v1'};send(200,responseEvidence);return;}
   if(url.pathname==='/site') {
    const body=!account?`<h1>${htmlEscape(scenario.marker)} Login</h1><form method="POST" action="/site/login"><label>账号<input name="account" autocomplete="username"></label><label>密码<input name="password" type="password" autocomplete="current-password"></label><button type="submit">登录</button></form>`:`<header>当前账号：<strong>${htmlEscape(account)}</strong></header><h1>${htmlEscape(scenario.marker)} Synthetic Cart</h1><p>版本：${calculate(10,2)===20?'fixture-fixed':'fixture-v1'}；单价：10.00；数量：2</p><button id="calculate">计算总价</button><p>总价：<output id="total">未计算</output></p><script>document.querySelector('#calculate').onclick=async()=>{const v=await(await fetch('/site/api/total')).json();document.querySelector('#total').textContent=v.total;console.log('M12 synthetic calculated',v.total);if(v.total!=='20.00')console.error('M12 synthetic price mismatch');};</script>`;
    send(200,`<!doctype html><meta charset="utf-8"><title>${htmlEscape(scenario.marker)}</title>${body}`,'text/html');return;
   }
   send(404,{error:'synthetic route absent'});
  } catch(error){if(!res.headersSent)send(500,{error:'fixture handler failed'});else res.destroy();}
  finally {await onRecord({at:new Date().toISOString(),method,path:url.pathname,status,responseEvidence,businessWriteAttempt:url.pathname.startsWith('/biz/api.php/')&&!['GET','HEAD'].includes(method),scope:url.pathname.startsWith('/biz/api.php/')?'m10':'site',account,requestIdentitySha256:digest(`${method} ${url.pathname}`)});}
 };
}
