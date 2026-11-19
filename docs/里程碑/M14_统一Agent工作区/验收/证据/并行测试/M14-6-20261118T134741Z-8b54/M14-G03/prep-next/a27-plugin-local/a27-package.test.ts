import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { inspectPluginDirectory } from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/core/applications/plugins/package';
import { capturePluginSession,pluginMcpToolName } from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/core/applications/plugins/session-tools';
import { buildPlugin,capability,marker } from './build.mjs';

it('the production plugin loader and task bridge support a fixed write with zero connection slots',()=>{
  const root=mkdtempSync(join(tmpdir(),'a27-package-'));
  try {
    const directory=buildPlugin(join(root,'fixture'));
    const loaded=inspectPluginDirectory(directory);
    expect(loaded.manifest.providers).toEqual([]);
    expect(loaded.manifest.permissions).toEqual([]);
    expect(loaded.manifest.capabilities[capability]).toMatchObject({semantics:'write',retry:'never',maxTier:'ask',slots:[]});
    expect(loaded.contracts.get(capability)?.input({marker}).valid).toBe(true);
    expect(loaded.contracts.get(capability)?.input({marker,path:'/outside'}).valid).toBe(false);
    const frozen=capturePluginSession({plugin:loaded,directory,bundleHash:loaded.hash,relativePath:'fixture'},[],'mcp');
    expect(frozen.connections).toEqual([]);
    expect(frozen.capabilities).toMatchObject([{id:capability,mcpTool:pluginMcpToolName(capability),slots:[],semantics:'write'}]);
  }finally{rmSync(root,{force:true,recursive:true});}
});
