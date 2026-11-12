// F-ZT public synthetic service. Reuses the routes and payload shapes in the
// production zentao-runtime / zentao-data tests, without a third-party endpoint.
import {createServer} from 'node:http';
export async function startZentaoFixture({total=51}={}) {
 const events=[],sockets=new Set();
 const accounts=new Map([['PUBLIC_P1_TOKEN_qa-a','qa-a'],['PUBLIC_P1_TOKEN_qa-b','qa-b']]);
 const attachment=Buffer.from('P1 synthetic attachment 中文🙂\n'.repeat(300));
 const fields=(id,account,kind)=>({id,title:`P1 合成 ${kind} ${id}`,status:'active',assignedTo:account,pri:2,severity:3,steps:'P1 旧版合成快照正文 中文🙂\n'.repeat(400),files:{9:{id:9,title:'P1 合成附件',extension:'txt',size:attachment.length}}});
 const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://127.0.0.1');
  if(req.method==='POST'&&u.pathname==='/api.php/v1/tokens'){
   let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>16384)throw Error('Fixture request too large');}
   const v=JSON.parse(text),valid=['qa-a','qa-b'].includes(v.account)&&v.password===`PUBLIC_P1_PASSWORD_${v.account}`;
   events.push({method:req.method,path:u.pathname,account:v.account,valid});return json(res,valid?{token:`PUBLIC_P1_TOKEN_${v.account}`}:{message:'Synthetic authentication rejected'},valid?200:401);
  }
  const account=accounts.get(req.headers.token);events.push({method:req.method,path:u.pathname,query:Object.fromEntries(u.searchParams),account:account??null});
  if(req.method!=='GET')return json(res,{message:'No write route in F-ZT'},405);
  if(!account)return json(res,{message:'Synthetic authentication rejected'},401);
  if(u.pathname==='/api.php/v1/user')return json(res,{profile:{account,id:account==='qa-a'?1:2}});
  if(u.pathname==='/api.php/v1/langs')return json(res,{bug:{status:'状态',statusList:{active:'激活'},pri:'优先级',priList:['','P1','P2','P3'],severityList:{3:'较大'}}});
  if(u.pathname==='/api.php/v2/my/work'){
   const kind=u.searchParams.get('mode'),page=Number(u.searchParams.get('pageID')),size=Number(u.searchParams.get('recPerPage'));
   if(!['bug','story'].includes(kind)||!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1)return json(res,{message:'Invalid synthetic paging'},400);
   const rows=Array.from({length:total},(_,i)=>{const v=fields(String(79291-i),account,kind);delete v.steps;delete v.files;return v;}).slice((page-1)*size,page*size);
   return json(res,{mode:kind,type:'assignedTo',pager:{recTotal:total,pageID:page,recPerPage:size,pageTotal:Math.ceil(total/size)},[kind==='bug'?'bugs':'stories']:rows});
  }
  const detail=/^\/api.php\/(?:v1\/bugs|v2\/stories)\/(\d+)$/.exec(u.pathname);
  if(detail){const kind=u.pathname.includes('/bugs/')?'bug':'story',value=fields(detail[1],account,kind);return json(res,{...value,actions:[{action:'opened',actor:account,comment:'P1 合成历史记录'}]});}
  if(u.pathname==='/api.php/v1/files/9'){res.writeHead(200,{'content-type':'text/plain','content-length':attachment.length});return res.end(attachment);}
  return json(res,{message:'Unknown synthetic route'},404);
 }catch(error){events.push({failure:String(error)});if(!res.headersSent)json(res,{message:'Synthetic fixture failed'},500);else res.destroy();}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl=`http://127.0.0.1:${server.address().port}/`;
 return {baseUrl,events,attachment,close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
