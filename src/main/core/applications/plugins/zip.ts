import {crc32} from 'node:zlib';
import type {Readable} from 'node:stream';
import {fromBufferPromise} from 'yauzl';
import {ApplicationError, isPackagePath} from '@shared/applications';
import {PLUGIN_LIMITS} from '@shared/plugins';
import {validatePluginBundle, type ValidatedPlugin} from './package';

/** Use the same bounded yauzl/CRC pattern as OfficePackage. Never extract untrusted ZIP paths. */
export async function inspectPluginZip(input: Buffer, signal?: AbortSignal): Promise<ValidatedPlugin> {
  const fail = (message: string): never => {throw new ApplicationError('INVALID_PACKAGE', message);};
  const check = () => {if (signal?.aborted) throw new ApplicationError('CANCELED', '插件检查已取消');};
  check();
  if (input.length > PLUGIN_LIMITS.packageBytes) fail('插件压缩包超过大小限制');
  const zip = await fromBufferPromise(input, {validateEntrySizes: true, strictFileNames: true});
  let active: Readable | undefined;
  const abort = () => {active?.destroy(new ApplicationError('CANCELED', '插件检查已取消')); zip.close();};
  signal?.addEventListener('abort', abort, {once: true});
  try {
    check();
    if (zip.entryCount > PLUGIN_LIMITS.files * 2) fail('插件压缩包条目超限');
    const files = new Map<string, Buffer>(), entries = new Set<string>(), executables = new Set<string>(); let total = 0;
    for await (const entry of zip.eachEntry()) {
      check();
      const directory = entry.fileName.endsWith('/'), name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      if (!isPackagePath(name) || name.split('/').length > PLUGIN_LIMITS.depth) fail('插件压缩包路径无效');
      if (entries.has(name.toLowerCase())) fail('插件压缩包包含重名条目'); entries.add(name.toLowerCase());
      const mode = entry.externalFileAttributes >>> 16 & 0o170000;
      if (mode && mode !== (directory ? 0o040000 : 0o100000)) fail('插件压缩包包含链接或特殊文件');
      if (entry.generalPurposeBitFlag & 0x41) fail('不支持加密插件压缩包');
      if (entry.uncompressedSize > PLUGIN_LIMITS.fileBytes || total + entry.uncompressedSize > PLUGIN_LIMITS.packageBytes || !directory && files.size >= PLUGIN_LIMITS.files) fail('插件压缩包展开大小或数量超限');
      active = await zip.openReadStreamPromise(entry); check();
      const chunks: Buffer[] = []; let size = 0, checksum = 0;
      for await (const raw of active) {
        check(); const chunk = Buffer.from(raw); size += chunk.length;
        if (size > entry.uncompressedSize || size > PLUGIN_LIMITS.fileBytes || total + size > PLUGIN_LIMITS.packageBytes) fail('插件实际解压大小超限');
        checksum = crc32(chunk, checksum); chunks.push(chunk);
      }
      active = undefined;
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) fail('插件文件大小或 CRC 校验失败');
      if (directory && size !== 0) fail('插件目录条目不能包含数据');
      total += size;
      if (!directory) {files.set(name, Buffer.concat(chunks, size));if (entry.externalFileAttributes >>> 16 & 0o111) executables.add(name);}
    }
    check(); return validatePluginBundle(files, undefined, executables);
  } catch (error) {
    check(); if (error instanceof ApplicationError) throw error;
    return fail('插件压缩包损坏或结构不完整');
  } finally {signal?.removeEventListener('abort', abort); active?.destroy(); zip.close();}
}
