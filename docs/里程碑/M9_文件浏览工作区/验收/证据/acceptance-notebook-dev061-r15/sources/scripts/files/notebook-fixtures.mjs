// Synthetic, non-executed Notebook acceptance data shared by native I and App A.
export const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDeUAAAAASUVORK5CYII=';
export const jpeg='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAB//9k=';
export function notebookFixtures({canary='/private/tmp/willyou-notebook-must-not-execute',trap='http://127.0.0.1:9/notebook-should-not-connect'}={}){
 const code=(source='',outputs=[],metadata={})=>({cell_type:'code',source,outputs,metadata,execution_count:7});
 const doc=(cells,title)=>JSON.stringify({nbformat:4,nbformat_minor:5,metadata:{title,language_info:{name:'python'}},cells});
 const source=`from pathlib import Path\nPath(${JSON.stringify(canary)}).write_text("BAD")\n# CODE_中文🙂\n`;
 const fixtures={
  'cell-code.ipynb':doc([code(source)],'Code fixture'),
  'cell-markdown.ipynb':doc([{cell_type:'markdown',source:'# MARKDOWN_中文🙂\n\n**bold fixture**'}],'Markdown fixture'),
  'cell-raw.ipynb':doc([{cell_type:'raw',source:'RAW_<literal>_中文🙂'}],'Raw fixture'),
  'cell-future.ipynb':doc([{cell_type:'future_type',source:'FUTURE_AS_RAW_中文🙂'}],'Unknown cell fixture'),
  'empty-code.ipynb':doc([code('')],'Empty code fixture'),
  'empty-markdown.ipynb':doc([{cell_type:'markdown',source:''}],'Empty Markdown fixture'),
  'empty-raw.ipynb':doc([{cell_type:'raw',source:''}],'Empty raw fixture'),
  'empty-notebook.ipynb':doc([],'Empty notebook fixture'),
  'stream-error.ipynb':doc([code('',[
   {output_type:'stream',name:'stdout',text:['STDOUT_中文🙂','\nline2']},
   {output_type:'stream',name:'stderr',text:'STDERR_中文🙂'},
   {output_type:'stream',name:'stdout'},
   {output_type:'error',ename:'ValueError',evalue:'ERROR_中文🙂',traceback:['TRACE_LINE_1\n','TRACE_LINE_2']},
  ],{codex:{outputSummaries:[{summaryMarkdown:'**STDOUT_SUMMARY**'},null,null,{summaryMarkdown:'**ERROR_SUMMARY**'}]}})],'Streams and error fixture'),
  'bad-json.ipynb':'{"cells":',
  'bad-schema.ipynb':JSON.stringify({cells:{bad:true}}),
  'unknown-output.ipynb':doc([code('# VALID_SOURCE_REMAINS',[
   {output_type:'future_output',text:'MUST_NOT_FAKE_OUTPUT'},
   {output_type:'display_data',data:{'application/x-unknown':'MUST_NOT_FAKE_MIME'}},
  ])],'Unknown outputs fixture'),
 };
 const all={'image/png':png,'image/jpeg':jpeg,'image/svg+xml':'<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="green"/></svg>','text/html':'<b>HTML_CHOSEN_中文</b>','text/markdown':'**MARKDOWN_CHOSEN_中文**','text/plain':'PLAIN_CHOSEN_中文','application/json':{jsonChosen:'JSON_中文🙂',nested:{value:7}},'application/vnd.vega.v5+json':{vegaChosen:'VEGA_中文🙂',marks:[{type:'rect'}]}};
 const keys=Object.keys(all);
 for(let index=0;index<keys.length;index++){
  const data=Object.fromEntries(keys.slice(index).map(key=>[key,all[key]]));
  fixtures[`mime-${index}.ipynb`]=doc([code('',[{output_type:'display_data',data},{output_type:'execute_result',execution_count:7,data}])],`MIME stage ${index}`);
 }
 for(const [name,data]of [['mime-empty-html',{'text/html':'  \n','text/markdown':'**NONEMPTY_MARKDOWN**','text/plain':'HIDDEN_PLAIN'}],['mime-empty-markdown',{'text/html':'','text/markdown':' \n','text/plain':'NONEMPTY_PLAIN'}]])fixtures[`${name}.ipynb`]=doc([code('',[{output_type:'display_data',data}])],name);
 const attack=`<b>SAFE_HTML_中文🙂</b><script>fetch('${trap}');parent.__notebookAttack=1;</script><img src="${trap}/img" onerror="parent.__notebookAttack=2"><form action="${trap}/form"><input name="x"></form><iframe src="${trap}/frame"></iframe><svg onload="parent.__notebookAttack=3"><foreignObject><script>parent.__notebookAttack=4</script></foreignObject></svg><img src="data:image/png;base64,${png}">`;
 fixtures['html-sandbox.ipynb']=doc([code('',[{output_type:'display_data',data:{'text/html':attack}}])],'HTML sandbox fixture');
 return{fixtures,source,canary,trap,attack,mimeKeys:keys};
}
