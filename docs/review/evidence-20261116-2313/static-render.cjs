const {buildSync}=require('node:module').createRequire(require('node:fs').realpathSync('/Users/liubu/hx/4.uprxiao/SmartDD/node_modules/vite/package.json'))('esbuild');
const fs=require('node:fs');const root='/Users/liubu/hx/4.uprxiao/SmartDD';
const out=process.env.M14_REVIEW_OUT;
const result=buildSync({stdin:{contents:`
import React from '${root}/node_modules/react/index.js';
import {renderToStaticMarkup} from '${root}/node_modules/react-dom/server.node.js';
import {M14TaskArea} from '${root}/prototypes/m6-codex/src/M14TaskArea.jsx';
import {writeFileSync} from 'node:fs';
const results=[];
for(const scenario of ['approval','question','business','plan','goal','goal-claude','team','merge-check']){
 globalThis.location={search:'?preview=m14&m14='+scenario};
 const html=renderToStaticMarkup(React.createElement(M14TaskArea,{projectRoot:'/workspace/SmartDD',taskId:'review-task',ptyId:'review-pty',onTerminal:()=>{}}));
 writeFileSync(${JSON.stringify(out)}+'/'+scenario+'-ssr.html',html);
 const stopLabels=[...html.matchAll(/aria-label="([^\"]*停止[^\"]*)"/g)].map(m=>m[1]);
 results.push({scenario,stopLabels,requestPanel:html.includes('m14-req-head')});
}
writeFileSync(${JSON.stringify(out)}+'/prototype-static-render.json',JSON.stringify({scope:'React static server rendering, not browser interaction',results},null,2));
console.log(JSON.stringify(results,null,2));
`,resolveDir:root,sourcefile:'review-render.jsx',loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',loader:{'.css':'empty'},write:false,logLevel:'error'});
const bundle='/private/tmp/m14-review-render-bundle.cjs';fs.writeFileSync(bundle,result.outputFiles[0].contents);require(bundle);
