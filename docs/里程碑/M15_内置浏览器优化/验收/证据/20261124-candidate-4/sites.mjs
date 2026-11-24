import {once} from 'node:events';
import {createServer} from 'node:http';

export const sensitiveMarker = 'm15-a23-synthetic-private-marker-5914';
const writeAction = `<form action="/record" method="post"><button type="submit" id="record">保存夹具记录</button></form>`;
function sendHtml(response, title, content){
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'})
    .end('<!doctype html><title>'+title+'</title><main>'+content+'</main>');
}
async function bind(server){
  const ready=once(server,'listening');
  server.listen(0,'127.0.0.1');
  await ready;
  return 'http://127.0.0.1:'+server.address().port;
}

export async function startBoundarySites(){
  const visits=[], errors=[];
  const traffic=site=>(req,res,url)=>{
    if(url.pathname==='/favicon.ico'){ res.writeHead(404).end(); return false; }
    visits.push({site,method:req.method,path:url.pathname,receivedAt:Date.now()});
    return true;
  };
  const recordA=traffic('owner'), recordB=traffic('other');
  const other=createServer((req,res)=>{
    try{
      const url=new URL(req.url,otherOrigin);
      if(!recordB(req,res,url))return;
      if(url.pathname==='/arrived')return sendHtml(res,'第二个合成站点', '<h1 id="foreign">重定向后的合成页</h1>'+writeAction);
      if(url.pathname==='/record'&&req.method==='POST')return res.writeHead(200).end('fixture record');
      res.writeHead(404).end();
    }catch(error){errors.push(error.message);res.writeHead(500).end();}
  });
  const otherOrigin=await bind(other);
  const owner=createServer((req,res)=>{
    try{
      const url=new URL(req.url,ownerOrigin);
      if(!recordA(req,res,url))return;
      if(url.pathname==='/home')return sendHtml(res,'原始合成业务页','<h1 id="fixture-ready">A23 原始页面</h1>');
      if(url.pathname==='/next')return sendHtml(res,'合成同站内页',
        '<h1 id="normal-marker" data-private="'+sensitiveMarker+'">A23 站内跳转通过</h1>'+writeAction);
      if(url.pathname==='/redirect')return res.writeHead(302,{Location:otherOrigin+'/arrived','Cache-Control':'no-store'}).end();
      if(url.pathname==='/record'&&req.method==='POST')return res.writeHead(200).end('fixture record');
      res.writeHead(404).end();
    }catch(error){errors.push(error.message);res.writeHead(500).end();}
  });
  let ownerOrigin;
  try { ownerOrigin=await bind(owner); }
  catch (error) { other.close(); throw error; }
  return {
    origin:ownerOrigin, otherOrigin, visits, errors,
    async close(){
      await Promise.all([owner,other].map(server=>{
        const closed=once(server,'close');
        server.close();server.closeAllConnections();return closed;
      }));
    },
  };
}
