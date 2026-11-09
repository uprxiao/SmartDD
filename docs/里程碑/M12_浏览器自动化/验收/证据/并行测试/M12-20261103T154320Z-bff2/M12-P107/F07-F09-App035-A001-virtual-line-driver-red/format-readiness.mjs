// Read-only current model/route/async-render snapshot. No store, DOM or editor mutation.
export const formatReadinessExpression=`(()=>{const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'},cm=document.querySelector('.cm-content'),model=cm?.cmTile?.root?.view?.state.doc.toString(),host=cm?.closest('.fw-editor-host'),u=document.querySelector('.fw-unsupported'),tab=document.querySelector('.fw-tab [role=tab][aria-selected=true]'),list=document.querySelector('.fw-name-results');return{at:new Date().toISOString(),focused:document.hasFocus(),visibility:document.visibilityState,theme:document.documentElement.className,tabTitle:tab?.title??null,cmCount:document.querySelectorAll('.cm-content').length,editor:{visible:visible(cm),label:cm?.getAttribute('aria-label')??null,contentEditable:cm?.getAttribute('contenteditable')??null,model:typeof model==='string'?model:null,rich:host?.classList.contains('fw-markdown-editable')??false,color:cm?getComputedStyle(cm).color:null,tokens:[...(cm?.querySelectorAll('.fw-code-token')??[])].map(e=>({text:e.textContent,color:getComputedStyle(e).color,style:e.getAttribute('style')}))},loading:[...document.querySelectorAll('.fw-empty[role=status]')].some(e=>e.textContent.includes('正在读取文件')),alerts:[...document.querySelectorAll('[role=alert],.fw-save-strip[role=status]')].map(e=>e.textContent),viewSource:!!document.querySelector('[aria-label="查看源码"]'),viewDocument:!!document.querySelector('[aria-label="查看文档"]'),rich:{frontmatter:document.querySelector('.fw-md-frontmatter')?.textContent??null,table:document.querySelector('.fw-md-table')?.textContent??null,tasks:[...document.querySelectorAll('input[data-md-task-line]')].map(e=>e.checked),tail:!![...document.querySelectorAll('.cm-content .cm-line')].find(e=>e.textContent==='TAIL_metadata')},unsupported:u?{visible:visible(u),text:u.textContent,name:u.querySelector('strong')?.textContent??null,path:u.querySelector('.fw-unsupported-path')?.title??null}:null,filter:{value:document.querySelector('[aria-label="筛选文件"]')?.value??null,busy:list?.getAttribute('aria-busy')??null,paths:[...(list?.querySelectorAll('[role=option]')??[])].map(e=>e.title)}}})()`;

export function formatReady(v,item,step){
 if(v.tabTitle!==item.path||v.loading||v.alerts.length||!v.focused||v.visibility!=='visible')return false;
 if(step==='binary')return v.cmCount===0&&v.unsupported?.visible&&v.unsupported.name===item.name&&v.unsupported.path===item.path&&v.unsupported.text.includes('二进制');
 const text=v.cmCount===1&&v.editor.visible&&v.editor.label===item.name+' 内容'&&v.editor.model===item.normalized&&v.editor.contentEditable==='true';
 if(!text)return false;
 if(step==='text')return !v.editor.rich&&!v.unsupported;
 if(step==='grammar')return !v.editor.rich&&!v.unsupported&&v.editor.tokens.some(x=>x.text.length&&x.color!==v.editor.color);
 if(step==='markdown-default')return v.editor.rich&&v.viewSource&&!v.viewDocument&&v.rich.tail;
 if(step==='markdown-rich')return v.editor.rich&&v.viewSource&&!v.viewDocument&&v.rich.frontmatter?.includes('METADATA_中文🙂')&&v.rich.table?.includes('TABLE_中文')&&v.rich.tasks.length===2&&v.rich.tasks[0]===false&&v.rich.tasks[1]===true;
 if(step==='source')return !v.editor.rich&&v.viewDocument&&!v.viewSource;
 return false;
}
export function formatReadiness({app,poll,mode,persist}){
 const wait=async(item,step,ms=20000)=>poll(async()=>{const value=await app.evaluate(formatReadinessExpression),accepted=formatReady(value,item,step);mode.readiness??=[];mode.readiness.push({file:item.name,step,accepted,value});await persist();return accepted?value:null;},ms);
 return{wait};
}
