// SSR fixture for an expanded home model menu. Only its initial `open` value is set true.
// Actual button markup, click handlers, parent form and submit handler are unchanged.
// No browser input or DOM action; production/source files are never written.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=process.cwd(),out=__dirname;
const {build}=createRequire(fs.realpathSync(path.join(root,'node_modules/vite/package.json')))('esbuild');
const target=path.join(root,'prototypes/m6-codex/src/M14TaskArea.jsx');
(async()=>{
 const original=fs.readFileSync(target,'utf8');
 const cut=original.indexOf('export function M14HomeModelPicker');
 const tail=original.slice(cut),old='const [open, setOpen] = useState(false)';
 if(!tail.includes(old))throw Error('Unexpected home model picker source');
 const fixture=original.slice(0,cut)+tail.replace(old,'const [open, setOpen] = useState(true)');
 const code=`
 import React from ${JSON.stringify(path.join(root,'node_modules/react/index.js'))};
 import {renderToStaticMarkup} from ${JSON.stringify(path.join(root,'node_modules/react-dom/server.node.js'))};
 import {ReferenceHome} from ${JSON.stringify(path.join(root,'prototypes/m6-codex/src/ReferenceHome.jsx'))};
 import {M14HomeModelPicker} from ${JSON.stringify(target)};
 export const html=renderToStaticMarkup(<ReferenceHome
  project={{id:'p',name:'Fixture',dirs:[{id:'d',available:true,path:'/workspace/SmartDD'}]}}
  projects={[]} profiles={[]} profile={{id:'old',name:'Existing Claude'}}
  dir={{id:'d',available:true,path:'/workspace/SmartDD'}} prompt="" setPrompt={()=>{}}
  onSubmit={()=>{}} onLaunchSettings={()=>{}}
  profilePicker={<M14HomeModelPicker value={{agent:'cx-ds',model:'deepseek-flash',effort:'中'}} onChange={()=>{}}/>}
 />);`;
 const compiled=await build({stdin:{contents:code,loader:'jsx',resolveDir:root},bundle:true,jsx:'automatic',format:'cjs',platform:'node',write:false,loader:{'.css':'empty'},
  plugins:[{name:'expanded-menu-state-fixture',setup(b){b.onLoad({filter:/M14TaskArea\.jsx$/},args=>args.path===target?{contents:fixture,loader:'jsx',resolveDir:path.dirname(target)}:undefined)}}]});
 const mod={exports:{}};new Function('module','exports','require',compiled.outputFiles[0].text)(mod,mod.exports,require);
 const html=mod.exports.html,body=html.slice(html.indexOf('<form'),html.indexOf('</form>')+7);
 const buttons=[...body.matchAll(/<button\b([^>]*)>/g)].map(m=>({tag:m[0],type:/\btype="([^"]*)"/.exec(m[1])?.[1]??null,label:/aria-label="([^"]*)"/.exec(m[1])?.[1]??null}));
 const scrim=buttons.find(b=>b.tag.includes('home-menu-scrim m14-fixed-scrim'));
 const result={scope:'Expanded-state SSR fixture; no live click or browser validation',sourceSha256:crypto.createHash('sha256').update(original).digest('hex'),fixtureOnlyChange:'initial open false -> true in M14HomeModelPicker',insideForm:true,scrim,implicitSubmitButtons:buttons.filter(b=>!b.type),buttonCount:buttons.length};
 fs.writeFileSync(path.join(out,'home-menu-open-ssr.html'),html);
 fs.writeFileSync(path.join(out,'home-menu-ssr.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1});
