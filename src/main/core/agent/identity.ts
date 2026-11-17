import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** 绑定身份使用物理路径；不存在的路径仍由执行器启动检查拒绝。 */
export function canonicalPath(path: string) { try { return realpathSync(path); } catch { return resolve(path); } }
