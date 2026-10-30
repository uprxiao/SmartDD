// Frozen behavioral examples derived from reviewed research section 11.
// No matcher import: expected scores/fragments are explicit specification data.
export function fuzzyRankingFixtures(){
 const files={},cases=[],add=path=>{files[path]='Native fuzzy fixture '+path+'\n';return path},entry=(path,expected)=>({path:add(path),expected});
 const scenario=(id,caseId,query,entries,extra={})=>{cases.push({id,caseId,query,candidates:entries.map(x=>x.path),expected:Object.fromEntries(entries.map(x=>[x.path,x.expected])),...extra})};
 scenario('zero-kept','M9-T-U04','foo',[
  entry('u04/foo-path/zero.txt',{score:0,matched:false,indices:[],fragments:[]}),
  entry('u04/foo.ts',{score:110024,matched:true,indices:[0,1,2],fragments:[{start:0,end:3}]})
 ],{selectPath:'u04/foo-path/zero.txt',before:'u04/foo.ts',after:'u04/foo-path/zero.txt'});
 const ties=['u05-tie/z/same.txt','u05-tie/a/same.txt','u05-tie/m/same.txt','u05-tie/n/2.txt','u05-tie/n/10.txt','u05-tie/l/alpha.txt','u05-tie/u/Alpha.txt','u05-tie/c/中.txt','u05-tie/p/\ue000.txt','u05-tie/e/😀.txt'];
 scenario('utf16-ties','M9-T-U05','tie',ties.map(path=>entry(path,{score:0,matched:false,indices:[]})),{scopePrefix:'u05-tie/',sortedLabels:['10.txt','2.txt','Alpha.txt','alpha.txt','same.txt','same.txt','same.txt','中.txt','😀.txt','\ue000.txt'],stableName:'same.txt',recentPath:'u05-tie/m/same.txt',selectPath:'u05-tie/p/\ue000.txt'});
 for(const query of['src/foo','src\\foo'])scenario('prefix-'+(query.includes('\\')?'backslash':'slash'),'M9-T-U06',query,[
  entry('u06/src/foo.ts',{score:110024,matched:true,matchMode:'path-basename-fallback',indices:[0,1,2]}),
  entry('u06/src/xfoo.ts',{score:0,matched:false,indices:[]})
 ],{selectPath:'u06/src/xfoo.ts'});
 for(const query of['src/foo/','src\\foo\\','src/foo\\','src\\foo/'])scenario('trailing-'+query,'M9-T-U06',query,[entry('u06/src/foo/child.txt',{score:0,matched:false,indices:[]})]);
 for(const n of[99,100,101]){
  const q='a'.repeat(n),exact='u07/ordinary/'+q+'.txt',gap='u07/ordinary/'+'a'.repeat(n-1)+'-a.txt';
  scenario('ordinary-'+n,'M9-T-U07',q,[entry(exact,{matched:true,longPattern:n>=100,score:110030-(n+4),fragments:[{start:0,end:n}]}),entry(gap,n===99?{matched:true,longPattern:false,score:109816,fragments:[{start:0,end:98},{start:99,end:100}]}:{matched:false,score:0,indices:[]})],{selectPath:gap});
 }
 for(const n of[100,101]){
  const q='a'.repeat(n),path='u07/src/'+q+'.txt',interior='u07/src/x'+q+'.txt';
  scenario('secondary-prefix-'+n,'M9-T-U07','src/'+q,[entry(path,{matched:true,matchMode:'path-basename-fallback',longPattern:n>100,fragments:[{start:0,end:n}]}),entry(interior,{matched:false,score:0,indices:[]})]);
 }
 scenario('short-space','M9-T-U08','f b',[entry('u08/f b/camel/fooBar',{matched:true,score:109914,fragments:[{start:0,end:1},{start:3,end:4}]}),entry('u08/f b/lower/foobar',{matched:false,score:0})]);
 scenario('short-star','M9-T-U08','f*b',[entry('u08/f b/lower/foobar',{matched:true,indices:[0,3]})]);
 scenario('digit-no-jump','M9-T-U08','12',[entry('u08/digits12/132',{matched:false,score:0}),entry('u08/digits12/item12',{matched:true,indices:[4,5]})]);
 scenario('digit-wildcard','M9-T-U08','1*2',[entry('u08/digits12/132',{matched:true,indices:[0,2]})]);
 scenario('dot-barrier','M9-T-U08','ab.c',[entry('u08/dot-ab.c/a.zzB.c',{matched:false,score:0}),entry('u08/dot-ab.c/aB.c',{matched:true,indices:[0,1,2,3]})]);
 scenario('minimum-interior-fragment','M9-T-U08','abcd',[entry('u08/abcd/xxab--cd.txt',{matched:false,score:0}),entry('u08/abcd/xxabc--d.txt',{matched:true,fragments:[{start:2,end:5},{start:7,end:8}]})]);
 scenario('short-complete-interior','M9-T-U08','ab',[entry('u08/abcd/xab',{matched:true,indices:[1,2]})]);
 const space='a'.repeat(98)+' b';scenario('long-literal-space','M9-T-U08',space,[entry('u08/'+space+'/'+space+'.txt',{matched:true,longPattern:true,fragments:[{start:0,end:100}]}),entry('u08/'+space+'/'+'a'.repeat(98)+'-b.txt',{matched:false,score:0})]);
 scenario('cjk-unit-length','M9-T-U09','中文',[entry('u09/中文x',{matched:true,score:110027,fragments:[{start:0,end:2}]}),entry('u09/中文😀x',{matched:true,score:110025,fragments:[{start:0,end:2}]})]);
 scenario('emoji-range','M9-T-U09','😀',[entry('u09/wrap😀done.ts',{matched:true,score:1,indices:[4,5],fragments:[{start:4,end:6}]})]);
 scenario('length-expanding-fold','M9-T-U09','İ',[entry('u09/İ-source/a/i.txt',{matched:false,score:0}),entry('u09/İ-source/b/İ.txt',{matched:true,score:110515,indices:[0],fragments:[{start:0,end:1}]}),entry('u09/İ-source/c/i\u0307.txt',{matched:false,score:0})]);
 scenario('no-client-pinyin','M9-T-U09','zhongwen',[entry('u09/zhongwen/中文.txt',{matched:false,score:0,indices:[]})]);
 scenario('no-client-accent-normalization','M9-T-U09','cafe',[entry('u09/cafe/café.txt',{matched:false,score:0,indices:[]})]);
 scenario('no-edit-distance','M9-T-U09','foz',[entry('u09/foz/foo.ts',{matched:false,score:0,indices:[]})]);
 return{files,cases};
}
const basename=p=>p.split(/[/\\]/).at(-1);
export function verifyFuzzyFixture(scenario,ranked,providerPaths=scenario.candidates){
 const same=(actual,expected,label)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(scenario.id+' '+label+' expected '+JSON.stringify(expected)+' received '+JSON.stringify(actual))};
 for(const[path,expected]of Object.entries(scenario.expected)){
  const row=ranked.find(x=>x.path===path);if(!row)throw Error(scenario.id+' missing provider candidate '+path);
  for(const[key,value]of Object.entries(expected))same(row[key],value,path+' '+key);
 }
 if(scenario.before)same(ranked.findIndex(x=>x.path===scenario.before)<ranked.findIndex(x=>x.path===scenario.after),true,'positive before zero');
 if(scenario.sortedLabels)same(ranked.filter(x=>x.path.startsWith(scenario.scopePrefix)).map(x=>x.file_name),scenario.sortedLabels,'UTF16 label order');
 if(scenario.stableName)same(ranked.filter(x=>x.path.startsWith(scenario.scopePrefix)&&x.file_name===scenario.stableName).map(x=>x.path),providerPaths.filter(p=>p.startsWith(scenario.scopePrefix)&&basename(p)===scenario.stableName),'same label retains provider order');
 return{scenario:scenario.id,caseId:scenario.caseId,checkedTargets:Object.keys(scenario.expected),rankedCount:ranked.length};
}
