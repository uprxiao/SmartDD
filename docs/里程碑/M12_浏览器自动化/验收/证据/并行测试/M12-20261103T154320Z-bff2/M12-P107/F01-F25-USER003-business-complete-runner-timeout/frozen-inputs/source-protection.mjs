// Full source record retained; only ctime is separately reported, never read xattrs.
export const protectedSourceFields=['sha256','device','inode','size','mode','mtimeNs'];
export function compareSourceProtection(before,after){
 const names=Object.keys(before).sort(),actual=Object.keys(after).sort(),sameNames=JSON.stringify(names)===JSON.stringify(actual),expected=[...protectedSourceFields,'ctimeNs'].sort();
 const rows=names.map(name=>{const a=before[name],b=after[name],shape=b&&JSON.stringify(Object.keys(a).sort())===JSON.stringify(expected)&&JSON.stringify(Object.keys(b).sort())===JSON.stringify(expected),changedFields=protectedSourceFields.filter(k=>!b||a[k]!==b[k]);return{name,protectedFieldsUnchanged:!!shape&&changedFields.length===0,changedFields,ctime:{before:a.ctimeNs,after:b?.ctimeNs,changed:a.ctimeNs!==b?.ctimeNs}}});
 return{protectedFields:[...protectedSourceFields],sameSourceNames:sameNames,protectedFieldsUnchanged:sameNames&&rows.every(x=>x.protectedFieldsUnchanged),rows,ctimeChanges:rows.filter(x=>x.ctime.changed).map(x=>({name:x.name,...x.ctime})),ctimeCause:'Not inferred; xattr values not read'};
}
