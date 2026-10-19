export function notebookDetailFixtures(){
 const source='print("SOURCE_中文🙂")\n',fixtures={},matrix=[];
 const code=(text,outputs=[],metadata={})=>({cell_type:'code',source:text,execution_count:7,metadata,outputs});
 const document=(cells,title)=>JSON.stringify({nbformat:4,nbformat_minor:5,metadata:{title,language_info:{name:'python'}},cells});
 const output={output_type:'stream',name:'stdout',text:'OUTPUT_REMAINS_中文🙂'};
 for(const[description,value]of [['missing',undefined],['empty',''],['space',' \n\t '],['present','Description **中文🙂**']])for(const hasOutput of [false,true]){
  const name=`fold-${description}-${hasOutput?1:0}.ipynb`,metadata=value===undefined?{}:{codex:{descriptionMarkdown:value}};
  fixtures[name]=document([code(source,hasOutput?[output]:[],metadata)],name);matrix.push({name,inner:description==='present',source,output:hasOutput,empty:false});
 }
 for(const[type,text]of [['empty',''],['whitespace',' \t\n  ']])for(const hasOutput of [false,true]){
  const name=`source-${type}-${hasOutput?1:0}.ipynb`;fixtures[name]=document([code(text,hasOutput?[output]:[],{codex:{descriptionMarkdown:'Description for empty source'}})],name);matrix.push({name,inner:false,source:text,output:hasOutput,empty:true});
 }
 for(const kind of ['raw','markdown']){const name=`fold-${kind}.ipynb`,text=kind==='raw'?'RAW_SOURCE_中文🙂':'# Markdown heading\n\nMARKDOWN_SOURCE_中文🙂';fixtures[name]=document([{cell_type:kind,source:text}],name);matrix.push({name,inner:false,source:text,output:false,empty:false,type:kind});}
 const longCode='print("'+'中文🙂_'.repeat(14500)+'")\n',longRaw='RAW_中文🙂\n'+'raw🙂中_'.repeat(14500)+'_END';
 fixtures['copy-code.ipynb']=document([code(longCode)],'Long source code');fixtures['copy-raw.ipynb']=document([{cell_type:'raw',source:longRaw}],'Long raw source');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="1800"><rect width="40" height="1800" fill="green"/></svg>',html='<div style="height:600px">HTML_DIMENSION_中文🙂</div>';
 const outputs=[{output_type:'display_data',data:{'image/svg+xml':svg}},{output_type:'display_data',data:{'text/html':html}},{output_type:'stream',text:'STREAM_RAW_中文🙂\nSECOND_LINE'},{output_type:'error',ename:'ValueError',evalue:'ERROR_RAW_中文🙂',traceback:['TRACE_ONE\n','TRACE_TWO']},{output_type:'display_data',data:{'application/json':{marker:'JSON_SUMMARY_RAW_中文🙂',nested:{value:7}}}},{output_type:'display_data',data:{'application/json':{marker:'JSON_NO_SUMMARY_中文🙂'}}}];
 fixtures['output-details.ipynb']=document([code('# Source remains read only\n',outputs,{codex:{outputSummaries:[null,null,{summaryMarkdown:'**STREAM_SUMMARY**'},{summaryMarkdown:'**ERROR_SUMMARY**'},{summaryMarkdown:'**JSON_SUMMARY**'}]}})],'Output details');
 return{fixtures,matrix,longCode,longRaw,svg,html};
}
