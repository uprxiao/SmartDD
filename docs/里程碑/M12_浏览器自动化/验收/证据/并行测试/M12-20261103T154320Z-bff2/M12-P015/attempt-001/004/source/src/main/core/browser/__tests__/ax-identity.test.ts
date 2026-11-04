import { describe, expect, it } from 'vitest';
import type { BrowserAXTree } from '../cdp-proxy';
import { browserAXIdentityMatches, indexBrowserAXTrees } from '../ax-identity';

const tree = (ids: number[], options: {name?:string;frameId?:string;sessionId?:string} = {}): BrowserAXTree => {
  const frameId = options.frameId ?? 'main';
  return {frameId,sessionId:options.sessionId,nodes:[
    {nodeId:'root',frameId,childIds:ids.map(String),role:{value:'RootWebArea'}},
    // CDP need not return the flat array in document order.
    ...[...ids].reverse().map(id=>({nodeId:String(id),backendDOMNodeId:id,role:{value:'button'},name:{value:options.name??'Action'}})),
  ]};
};
const button = (value:BrowserAXTree) => indexBrowserAXTrees([value]).ordered.find(node=>node.role==='button')!;

describe('browser AX node identity by semantic position',()=>{
  it('uses child order and keeps duplicate names in their own frame/session',()=>{
    const index=indexBrowserAXTrees([tree([7,8]),tree([7,9],{frameId:'child',sessionId:'oopif'}),tree([7,8])]);
    expect(index.ordered.map(node=>[node.backendNodeId,node.frameId,node.ordinal])).toEqual([
      [7,'main',0],[8,'main',1],[7,'child',0],[9,'child',1],
    ]);
  });
  it('rejects replacement, rename, duplicate insertion and reordering while accepting unrelated updates',()=>{
    const original=button(tree([7,8]));
    expect(browserAXIdentityMatches(indexBrowserAXTrees([tree([7,8])]),original)).toBe(true);
    expect(browserAXIdentityMatches(indexBrowserAXTrees([tree([29,8])]),original)).toBe(false);
    expect(browserAXIdentityMatches(indexBrowserAXTrees([tree([7,8],{name:'Renamed'})]),original)).toBe(false);
    expect(browserAXIdentityMatches(indexBrowserAXTrees([tree([29,7,8])]),original)).toBe(false);
    expect(browserAXIdentityMatches(indexBrowserAXTrees([tree([8,7])]),original)).toBe(false);
    const other=tree([7,8]);other.nodes.push({nodeId:'unrelated',backendDOMNodeId:99,role:{value:'paragraph'},name:{value:'updated'}});
    expect(browserAXIdentityMatches(indexBrowserAXTrees([other]),original)).toBe(true);
  });
  it('detects the helper observing B even when both outside samples see A',()=>{
    const before=indexBrowserAXTrees([tree([7])]), captured=button(tree([29])), after=indexBrowserAXTrees([tree([7])]);
    expect(browserAXIdentityMatches(before,captured)).toBe(false);
    expect(browserAXIdentityMatches(after,captured)).toBe(false);
    const stable=button(tree([29]));
    expect(browserAXIdentityMatches(indexBrowserAXTrees([tree([29])]),stable)).toBe(true);
  });
  it('does not count ignored same-name nodes or conflate identical backend numbers in other sessions',()=>{
    const value=tree([7,8]);value.nodes.find(node=>node.backendDOMNodeId===7)!.ignored=true;
    const expected=button(value);expect(expected.backendNodeId).toBe(8);expect(expected.ordinal).toBe(0);
    expect(browserAXIdentityMatches(indexBrowserAXTrees([tree([8],{frameId:'main',sessionId:'other'})]),expected)).toBe(false);
  });
});
