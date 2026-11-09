const {app,BrowserWindow}=require('electron');
let win;
app.whenReady().then(async()=>{
 win=new BrowserWindow({width:900,height:600,x:-1800,y:0,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await win.loadURL('data:text/html,'+encodeURIComponent('<title>M12 R1.1 E4d private</title><button id="original">Action</button><script>window.hits=[];document.addEventListener("click",e=>hits.push(e.target.id),true)</script>'));
 win.showInactive(); process.send({ready:true,versions:process.versions});
});
process.on('message',m=>{if(m==='close')app.quit()});
app.on('window-all-closed',()=>app.quit());
