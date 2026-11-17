import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
import {isHostBusinessCli,literalShellWords} from './host-cli-command';
it('only a single literal invocation of the host-minted CLI may bypass the duplicate native tool prompt',()=>{
 const root=mkdtempSync(join(tmpdir(),'m14-host-cli-'));try{const path=join(root,'willyou-app'),bytes='controlled host CLI';writeFileSync(path,bytes);const proof={path,sha256:createHash('sha256').update(bytes).digest('hex')},env={PATH:root+':/usr/bin:/bin'};
 expect(isHostBusinessCli({command:`willyou-app mail draft --json '{"text":"literal $HOME; echo x"}'`},proof,env)).toBe(true);
 for(const command of ['willyou-app mail draft; touch /tmp/no','willyou-app mail draft | sh','willyou-app mail draft > /tmp/no','willyou-app mail draft $(echo x)','willyou-app mail draft "$HOME"','env willyou-app mail draft','sh -c "willyou-app mail draft"','willyou-app mail draft && echo x','willyou-app mail draft\necho x'])expect(isHostBusinessCli({command},proof,env)).toBe(false);
 expect(isHostBusinessCli({command:'willyou-app mail draft',dangerouslyDisableSandbox:true},proof,env)).toBe(false);
 expect(isHostBusinessCli({command:'willyou-app mail draft'},proof,{PATH:'/usr/bin:'+root})).toBe(false);writeFileSync(path,'replaced');expect(isHostBusinessCli({command:'willyou-app mail draft'},proof,env)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('quoted shell words preserve exact arguments and reject all expansion syntax',()=>{
 expect(literalShellWords(`willyou-app 'mail' "draft" '{"value":"a b"}'`)).toEqual(['willyou-app','mail','draft','{"value":"a b"}']);expect(literalShellWords('willyou-app "unterminated')).toBeNull();expect(literalShellWords('willyou-app `whoami`')).toBeNull();
});
