import {expect,it} from 'vitest';
import {pluginCatalogIcons} from '../catalog-assets';
import type {ValidatedPlugin} from '../package';
const fixture=(icon:ValidatedPlugin['manifest']['icon'],files:Record<string,Buffer>)=>({manifest:{icon},files:new Map(Object.entries(files))});
it('uses the actual declared theme-specific package bytes without exposing file or network locations',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,1]),svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
  const actual=pluginCatalogIcons(fixture({light:'assets/light.png',dark:'assets/dark.svg'},{'assets/light.png':png,'assets/dark.svg':svg}));
  expect(actual).toEqual({light:'data:image/png;base64,'+png.toString('base64'),dark:'data:image/svg+xml;base64,'+svg.toString('base64')});
});
it('falls back for absent, oversized or nonimage resources instead of returning executable content',()=>{
  expect(pluginCatalogIcons(fixture(undefined,{}))).toBeNull();
  expect(pluginCatalogIcons(fixture({light:'assets/secret.html',dark:'assets/huge.png'},{'assets/secret.html':Buffer.from('<script>window.BAD=1</script>'),'assets/huge.png':Buffer.alloc(128*1024+1)}))).toEqual({light:null,dark:null});
  expect(pluginCatalogIcons(fixture({light:'absent.png',dark:'https://remote.invalid/a.png'},{}))).toEqual({light:null,dark:null});
});
