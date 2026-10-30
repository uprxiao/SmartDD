// Source is authoritative UTF-16. CodeMirror uses one LF unit for every line break.
export function offsetMap(raw) {
  const breaks=[];let normalized='',from=0,extra=0;
  const re=/\r\n|\r|\n/g;let m;
  while((m=re.exec(raw))){normalized+=raw.slice(from,m.index)+'\n';if(m[0].length===2)breaks.push({raw:m.index,cm:m.index-extra});extra+=m[0].length-1;from=re.lastIndex;}
  normalized+=raw.slice(from);
  const cmToRaw=p=>{if(!Number.isInteger(p)||p<0||p>normalized.length)throw new Error('invalid CM position');let lo=0,hi=breaks.length;while(lo<hi){const mid=(lo+hi)>>1;if(breaks[mid].cm<p)lo=mid+1;else hi=mid;}return p+lo;};
  const rawToCm=p=>{if(!Number.isInteger(p)||p<0||p>raw.length)throw new Error('invalid raw position');let lo=0,hi=breaks.length;while(lo<hi){const mid=(lo+hi)>>1;if(breaks[mid].raw<p)lo=mid+1;else hi=mid;}return p-lo;};
  return {raw,normalized,cmToRaw,rawToCm};
}
export function preferredEol(raw){const counts={'\r\n':0,'\r':0,'\n':0};for(const match of raw.matchAll(/\r\n|\r|\n/g))counts[match[0]]++;if(!Object.values(counts).some(Boolean))return '\n';return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]||'\n';}

export function eolRuns(raw){const runs=[];for(const m of raw.matchAll(/\r\n|\r|\n/g)){if(runs.at(-1)?.[1]===m[0])runs.at(-1)[0]++;else runs.push([1,m[0]]);}return runs;}
export function restoreEols(raw,runs){let group=0,count=0,used=0;const value=raw.replace(/\r\n|\r|\n/g,()=>{if(!runs[group])throw new Error('EOL restore mismatch');const eol=runs[group][1];used++;if(++count===runs[group][0]){group++;count=0;}return eol;});if(used!==runs.reduce((n,r)=>n+r[0],0))throw new Error('EOL count mismatch');return value;}
