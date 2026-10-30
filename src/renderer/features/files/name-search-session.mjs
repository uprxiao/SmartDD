import {rankFileCandidates} from './file-fuzzy-model.mjs';

// Each snapshot replaces the previous ranked prefix. Stable merging gives the
// exact existing full-candidate ordering while scoring each candidate once.
function merge(left,right){
 if(!left.length)return right;if(!right.length)return left;
 if(left[0].matchMode==='empty')return [...left,...right];
 const result=[];let a=0,b=0;
 const before=(x,y)=>x.score>y.score||x.score===y.score&&x.file_name<=y.file_name;
 while(a<left.length&&b<right.length)result.push(before(left[a],right[b])?left[a++]:right[b++]);
 return result.concat(left.slice(a),right.slice(b));
}
export function rankNameCandidates(query,candidates,onUpdate){
 const seen=new Set(),unique=candidates.filter(candidate=>{if(seen.has(candidate.path))return false;seen.add(candidate.path);return true;});
 if(!onUpdate)return rankFileCandidates(query,unique);
 const batch=Math.max(1,Math.ceil(unique.length/4));let ranked=[];
 for(let offset=0;offset<unique.length;offset+=batch){ranked=merge(ranked,rankFileCandidates(query,unique.slice(offset,offset+batch)));if(offset+batch<unique.length)onUpdate(ranked);}
 return ranked;
}
