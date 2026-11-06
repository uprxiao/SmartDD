/** Pure source identity check, shared by the App and its synthetic prototype.
 * It does not authorize paths. Local sources still need a main-process lease. */
export const NONLOCAL_WORKSPACE_MESSAGE = '本期不支持远程工作区；远程记录仍保留，未连接或读取远程文件。';
export function isNonLocalFileSource(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.hostId !== undefined && value.hostId !== 'local') return true;
  if (value.remotePath !== undefined) return true;
  return [value.sourcePath, value.path, value.cwd].some(path => typeof path === 'string' && /^(?:[a-z][a-z\d+.-]*:\/\/|\/\/|\\\\)/i.test(path));
}
