export function csvAcceptanceFixtures(){
  const rows=[['name','quoted','multiline','empty','formula'],['中文🙂','comma, plus\tTAB','line 1\r\nline 2','','=SUM(A1:A2)'],['0012345678901234567','say "Hello"','末行'],['empty','','','',"+literal_text"]];
  const encode=(delimiter)=>rows.map((row,i)=>row.map(value=>/[",\t\r\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value).join(delimiter)+['\r\n','\n','\r','\r\n'][i]).join('');
  const csv=encode(','),tsv=encode('\t');
  return{cases:[
    {name:'matrix.csv',source:csv,delimiter:',',rows},
    {name:'matrix.tsv',source:tsv,delimiter:'\t',rows},
    {name:'bom.csv',source:'\uFEFF'+csv,delimiter:',',rows,bom:true},
    {name:'empty.csv',source:'',delimiter:',',rows:[]},
    {name:'unclosed.tsv',source:'name\tvalue\r\n"unclosed\t中文🙂',delimiter:'\t',invalid:true},
  ]};
}
