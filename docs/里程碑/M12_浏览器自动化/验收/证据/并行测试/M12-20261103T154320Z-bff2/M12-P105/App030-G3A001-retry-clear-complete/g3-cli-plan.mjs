// Original G3 only: nine non-tested setup reads/creates, two blocked reads,
// four Cookie readbacks after actual UI retry and four after actual UI clear.
export function g3CliPlan(c){
 const read=(tag,url)=>({tag,argv:['browser','cookie','get','--url',url,'--page',c.pageId],expectedCode:0,expectedError:null,capability:'browser.cookie.get',effect:'read-only'});
 const blocked=tag=>({tag,argv:['browser','snapshot','--page',c.pageId],expectedCode:2,expectedError:'BROWSER_UNAVAILABLE',capability:'browser.nav.snapshot',effect:'read-only'});
 const domains=[['qa','http://qa.example.test/'],['other','http://other.example.test/'],['google','http://google.com/'],['youtube','http://youtube.com/']];
 return[
  {tag:'identity',argv:['browser','identity','get'],expectedCode:0,expectedError:null,capability:'browser.identity.get',effect:'read-only'},
  {tag:'create-local-page',argv:['browser','tab','create','--url',c.url],expectedCode:0,expectedError:null,capability:'browser.tab.create',effect:'completed'},
  {tag:'create-form-page',argv:['browser','tab','create','--url',c.formURL],expectedCode:0,expectedError:null,capability:'browser.tab.create',effect:'completed'},
  ...[['prepare-writer-snapshot',c.pageId],['prepare-form-snapshot',c.formPageId]].map(([tag,page])=>({tag,argv:['browser','snapshot','--page',page],expectedCode:0,expectedError:null,capability:'browser.nav.snapshot',effect:'read-only'})),
  ...domains.map(([tag,url])=>read('before-'+tag,url)),blocked('needs-attention-first-cli'),
  ...domains.map(([tag,url])=>read('retry-'+tag,url)),blocked('needs-attention-second-cli'),
  ...domains.map(([tag,url])=>read('clear-'+tag,url))
 ];
}
