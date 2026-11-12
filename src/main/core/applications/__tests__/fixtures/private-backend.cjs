// Synthetic, loopback Unix transport only. No model, HOME config, auth or provider.
const net=require('node:net'),{spawn}=require('node:child_process');
const leaves=new Set(),sockets=new Set();
const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  let text='';socket.on('data',chunk=>{
    text+=chunk.toString();let end;
    while((end=text.indexOf('\n'))>=0){
      const command=JSON.parse(text.slice(0,end));text=text.slice(end+1);
      if(command.method==='spawn-leaf'){
        const code=`const socket=require('node:net').connect(process.argv[1]);socket.on('error',()=>process.exit(2));socket.on('connect',()=>socket.write('synthetic-peer\\n'));setInterval(()=>{},10000);`;
        const child=spawn(process.execPath,['-e',code,command.path],{env:{ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore'});
        leaves.add(child);child.once('exit',()=>leaves.delete(child));child.once('error',()=>leaves.delete(child));
      }
    }
  });
});
server.listen(process.argv[2],()=>process.stdout.write('ready\n'));
let closing=false;
const close=async()=>{
  if(closing)return;closing=true;
  for(const socket of sockets)socket.destroy();
  await Promise.all([...leaves].map(child=>new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
    child.once('exit',resolve);child.once('error',resolve);child.kill('SIGTERM');
  })));
  server.close(()=>process.exit(0));
};
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
