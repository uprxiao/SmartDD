const inputGuard = String.raw`(()=>{
 const apply=Reflect.apply.bind(Reflect),prevent=Event.prototype.preventDefault,stop=Event.prototype.stopImmediatePropagation,path=Event.prototype.composedPath;
 const inputType=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'type').get,show=HTMLInputElement.prototype.showPicker,Exception=DOMException;
 const clipboard=Object.getOwnPropertyDescriptor(ClipboardEvent.prototype,'clipboardData').get,files=Object.getOwnPropertyDescriptor(DataTransfer.prototype,'files').get,fileCount=Object.getOwnPropertyDescriptor(FileList.prototype,'length').get;
 const deny=e=>{apply(prevent,e,[]);apply(stop,e,[])};
 const isFile=n=>{try{return apply(inputType,n,[])==='file'}catch{return false}};
 for(const name of ['dragenter','dragover','drop'])addEventListener(name,deny,{capture:true});
 addEventListener('click',e=>{const nodes=apply(path,e,[]);for(let i=0;i<nodes.length;i++)if(isFile(nodes[i])){deny(e);break}},{capture:true});
 addEventListener('paste',e=>{const transfer=apply(clipboard,e,[]);if(transfer&&apply(fileCount,apply(files,transfer,[]),[])>0)deny(e)},{capture:true});
 if(show)Object.defineProperty(HTMLInputElement.prototype,'showPicker',{value:function(){if(isFile(this))throw new Exception('File selection is unavailable in this viewer','NotAllowedError');return apply(show,this,[])},writable:false,configurable:false});
 for(const name of ['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'])Object.defineProperty(window,name,{value:async()=>{throw new Exception('File selection is unavailable in this viewer','NotAllowedError')},writable:false,configurable:false});
 for(const key of ['open','write','writeln'])Object.defineProperty(Document.prototype,key,{value:()=>undefined,writable:false,configurable:false});
})()`;
/** Trusted outer document; untrusted HTML only enters its opaque child Blob. */
export function nativeViewerDocument():string{
 return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body,iframe{border:0;margin:0;width:100%;height:100%;overflow:hidden}</style><script>
 let child=null,url=null;
 const guard=${JSON.stringify('<script>'+inputGuard+'</script>').replaceAll('<','\\u003c')};
 window.willyouMcpUi.receive(value=>{
  if(typeof value?.html==='string'&&!child){
   const csp="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
   const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp+'">'+guard+value.html;
   url=URL.createObjectURL(new Blob([html],{type:'text/html'}));child=document.createElement('iframe');child.sandbox='allow-scripts';child.allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'";child.referrerPolicy='no-referrer';child.src=url;document.body.appendChild(child);
  }else if(child&&value?.payload)child.contentWindow.postMessage(value.payload,'*');
 });
 addEventListener('message',event=>{if(child&&event.source===child.contentWindow&&event.origin==='null'&&event.data?.jsonrpc==='2.0')window.willyouMcpUi.send(event.data)});
 addEventListener('pagehide',()=>{if(url)URL.revokeObjectURL(url)});
 </script><body></body>`;
}
