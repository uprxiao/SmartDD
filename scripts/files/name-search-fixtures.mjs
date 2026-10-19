import{mkdir,writeFile}from'node:fs/promises';
import{dirname,join}from'node:path';
export const excludedNames=['.git','.hg','.next','.pnpm-store','.svn','.turbo','.yarn','build','coverage','dist','node_modules'];
export const nameSearchFiles=[
 'collapsed/one/two/DeepOnly_唯一.ts','foo.ts','foo-path/zero.txt','a/foo.ts','foobar.ts','a/f-o-o.ts','bar.txt',
 '中文资料.txt','space name.txt','MiXeDCase.txt','emoji😀-报告.txt',
 ...excludedNames.map(name=>name+'/unique.txt'),'nested/node_modules/unique.txt',
 'allowed/unique.txt','my_node_modules/unique.txt','abc.git/aunique.txt','build-artifacts/unique.txt','.gitignore',
];
export async function createNameSearchFiles(root){
 for(const relative of nameSearchFiles){const path=join(root,relative);await mkdir(dirname(path),{recursive:true});await writeFile(path,'Name search fixture '+relative+'\n');}
}
