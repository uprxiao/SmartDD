// Finite AX account label+strong sequence; never mutates original snapshot or evaluates source.
import {createHash} from 'node:crypto';
export function accountFromSnapshot(snapshot){
 if(typeof snapshot!=='string'||snapshot.length>512*1024)return null;
 const lines=snapshot.split(/\\n|\r?\n/),nodes=[];
 for(let i=0;i<lines.length;i++){const m=/^(\s*)-\s+(banner|StaticText|strong)(?:\s+([\s\S]*))?$/.exec(lines[i]);nodes.push(m?{line:i+1,depth:m[1].length,role:m[2],value:m[3]??''}:null);}
 const atom=raw=>{let value=raw.trim();if(value.startsWith('\\"')&&value.endsWith('\\"'))value='"'+value.slice(2,-2)+'"';try{const v=JSON.parse(value);return typeof v==='string'?v:null;}catch{return null;}};
 const matches=[];
 for(let i=0;i<nodes.length;i++){const banner=nodes[i],label=nodes[i+1],strong=nodes[i+2],name=nodes[i+3];if(banner?.role!=='banner'||label?.role!=='StaticText'||strong?.role!=='strong'||name?.role!=='StaticText')continue;if(!(label.depth>banner.depth&&strong.depth===label.depth&&name.depth>strong.depth))continue;if(!/^当前账号[：:]$/.test(atom(label.value)??''))continue;const account=atom(name.value);if(!/^[A-Za-z0-9_-]{1,80}$/.test(account??''))continue;matches.push({account,labelLine:label.line,valueLine:name.line,bannerLine:banner.line,kind:'exact-AX-banner-label-strong-text'});}
 if(matches.length!==1)return null;return{...matches[0],snapshotSHA256:createHash('sha256').update(snapshot).digest('hex')};
}
