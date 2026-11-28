const {app,BaseWindow,WebContentsView}=require('electron');
app.setPath('userData','/private/tmp/m16-native-view-lost-probe-data');
function probe(label,cb){try{console.log(label,JSON.stringify(cb()));}catch(e){console.log(label,e.name,e.message,e.stack?.split('\n')[1]);}}
app.whenReady().then(async()=>{
 const root=new BaseWindow({show:false,width:400,height:300});const view=new WebContentsView({webPreferences:{sandbox:true}}); const wc=view.webContents;root.contentView.addChildView(view);await wc.loadURL('about:blank');
 wc.once('destroyed',()=>{
  probe('captured wc isDestroyed',()=>wc.isDestroyed());probe('view getter is null',()=>view.webContents===null);probe('view getter isDestroyed',()=>view.webContents.isDestroyed());probe('root children includes',()=>root.contentView.children.includes(view));probe('remove',()=>{root.contentView.removeChildView(view);return true;});setImmediate(()=>{root.close();app.quit()});
 });wc.close({waitForBeforeUnload:false});
}).catch(e=>{console.error(e);app.exit(1)});
