// A separate isolated real Chromium process, used only as an out-of-scope target.
const {app,BrowserWindow}=require('electron');
if(!process.env.T039_TARGET_USERDATA?.startsWith('/private/tmp/willyou-m12-t039-executor-001/'))throw Error('Private target only');
app.setPath('userData',process.env.T039_TARGET_USERDATA);let win;
app.whenReady().then(async()=>{win=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,width:640,height:480,title:'[I] T039 private Chromium target',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('data:text/html,<title>T039 isolated target</title><h1>Not an authorized page</h1>');process.send?.({ready:true,pid:process.pid,chromium:process.versions.chrome,userData:app.getPath('userData')})}).catch(e=>{process.send?.({fatal:String(e.stack??e)});app.exit(1)});
process.on('message',message=>{if(message.command==='close'){win?.destroy();app.quit()}});app.on('window-all-closed',()=>{});
