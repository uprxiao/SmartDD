import {basename,dirname,isAbsolute} from 'node:path';
import {ApplicationError} from '@shared/applications';

/** Read-only program paths supplied by the Electron host, never plugin input. */
export function pluginHostReadOnlyRoots(appPath:string,executable:string):string[]{
  const binaries=dirname(executable),contents=dirname(binaries),bundle=dirname(contents);
  if(!isAbsolute(appPath)||!isAbsolute(executable)||basename(binaries)!=='MacOS'||basename(contents)!=='Contents'||!basename(bundle).endsWith('.app')){
    throw new ApplicationError('HOST_INCOMPATIBLE','无法确认插件宿主程序的完整只读边界');
  }
  // Protect the entire bundle, including Frameworks, unpacked native modules,
  // bundled plugins and the directory entries used to replace those resources.
  // In development appPath is the project, outside the Electron.app bundle.
  return [...new Set([appPath,bundle])];
}
