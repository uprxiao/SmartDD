import assert from'node:assert/strict';
// Finite source contract only: never imports or executes Python/OS body.
export function assertCleanupRootBinding(code,expectedRoot,referenceCode,referenceRoot){
 assert(code.includes('root = Path(sys.argv[1]).resolve()'),'Cleanup argument must be canonicalized');
 const roots=[...code.matchAll(/^assert root == Path\('([^'\n]+)'\)$/gm)].map(x=>x[1]);assert.deepEqual(roots,[expectedRoot],'One exact currentRoot guard required');
 const normalized=(text,root)=>text.replaceAll(root,'__EXACT_OWNED_ROOT__').replaceAll('F16','F21');
 assert.equal(normalized(code,expectedRoot),normalized(referenceCode,referenceRoot),'Keep actual Root verification body unchanged');
 return{exactRoot:expectedRoot,canonicalArg:true,uniqueGuard:true,wholeBodyMatchesRootActualVerifier:true};
}
