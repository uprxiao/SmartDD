import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,symlink,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BrowserArtifacts} from '../artifacts';
it('counts artifact bytes, serializes clearing after writes, and preserves downloads and symlink targets',async()=>{
  const root=await mkdtemp(join(tmpdir(),'willyou-m12-artifacts-')),artifacts=new BrowserArtifacts(join(root,'browser-files'));
  try{await writeFile(join(root,'download.csv'),'keep');await artifacts.write('task','screenshot','png',Buffer.from('image'));await symlink(join(root,'download.csv'),join(artifacts.root,'external'));expect(await artifacts.usage()).toBe(5);
    const writing=artifacts.write('task','pdf','pdf',Buffer.alloc(1024*1024)),clearing=artifacts.clear();await writing;await clearing;expect(await artifacts.usage()).toBe(0);expect(await readdir(artifacts.root)).toEqual([]);expect(await readFile(join(root,'download.csv'),'utf8')).toBe('keep');
    const linked=new BrowserArtifacts(join(root,'linked'));await symlink(root,linked.root);await expect(linked.clear()).rejects.toThrow('实际目录');expect(await readFile(join(root,'download.csv'),'utf8')).toBe('keep');
  }finally{await rm(root,{recursive:true,force:true});}
});
