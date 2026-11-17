// 输入框附件（需求 R01、用例 A75）：项目内文件按路径引用；项目外文件复制为附件并注明，不放开 Agent 对项目外的读取；
// 附件随所属输入冻结（排队、编辑、发送都处理整份输入）。
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { DriverError } from './driver';

export const ATTACHMENT_LIMIT = 20 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export interface Attachment {
  id: string;
  kind: 'path' | 'file';
  name: string;
  mime: string;
  size: number;
  image: boolean;
  /** kind=path：相对任务工作目录的路径。 */
  relativePath?: string;
  /** kind=file：WillYou 私有目录中的副本。 */
  storedPath?: string;
}

const safeName = (name: string) => basename(name).replace(/[\x00-\x1f/\\:]/g, '_').slice(0, 120) || 'attachment';
const mimeOf = (name: string, given?: string) => IMAGE_MIME[extname(name).toLowerCase()] ?? (given && /^[\w.+-]+\/[\w.+-]+$/.test(given) ? given : 'application/octet-stream');

export function prepareAttachment(input: { cwd: string; userData: string; name: string; mime?: string; sourcePath?: string; dataBase64?: string }): Attachment {
  const name = safeName(input.name), mime = mimeOf(name, input.mime), id = randomUUID();
  const image = mime.startsWith('image/');
  if (input.sourcePath) {
    let real: string;
    try { real = realpathSync(input.sourcePath); } catch { throw new DriverError('REJECTED', '文件不存在或无法读取'); }
    const st = statSync(real);
    if (!st.isFile()) throw new DriverError('REJECTED', '只能添加文件');
    if (st.size > ATTACHMENT_LIMIT) throw new DriverError('REJECTED', `文件超过 ${ATTACHMENT_LIMIT / 1024 / 1024} MB`);
    const root = realpathSync(input.cwd), rel = relative(root, real);
    if (rel && rel !== '..' && !rel.startsWith(`..${sep}`)) return { id, kind: 'path', name, mime, size: st.size, image, relativePath: rel };
    const dir = join(input.userData, 'agent-attachments', id); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const storedPath = join(dir, name); copyFileSync(real, storedPath);
    return { id, kind: 'file', name, mime, size: st.size, image, storedPath };
  }
  if (!input.dataBase64) throw new DriverError('REJECTED', '附件内容为空');
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (!bytes.length) throw new DriverError('REJECTED', '附件内容为空');
  if (bytes.length > ATTACHMENT_LIMIT) throw new DriverError('REJECTED', `文件超过 ${ATTACHMENT_LIMIT / 1024 / 1024} MB`);
  const dir = join(input.userData, 'agent-attachments', id); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const storedPath = join(dir, name); writeFileSync(storedPath, bytes, { mode: 0o600 });
  return { id, kind: 'file', name, mime, size: bytes.length, image, storedPath };
}

/** 附件元数据只接受宿主先前准备的形状；提交时重新核对副本存在、路径未越出工作目录。 */
export function verifyAttachments(list: unknown, cwd: string, userData: string): Attachment[] {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 20) throw new DriverError('REJECTED', '附件无效');
  const root = realpathSync(cwd), store = join(realpathSync(userData), 'agent-attachments');
  return list.map((a: any) => {
    if (!a || typeof a.id !== 'string' || (a.kind !== 'path' && a.kind !== 'file')) throw new DriverError('REJECTED', '附件无效');
    if (a.kind === 'path') {
      const rel = String(a.relativePath ?? ''), real = (() => { try { return realpathSync(join(root, rel)); } catch { return ''; } })();
      const r = relative(root, real);
      if (!real || !r || r === '..' || r.startsWith(`..${sep}`)) throw new DriverError('REJECTED', `附件已不在项目内：${rel}`);
      return { id: a.id, kind: 'path', name: safeName(a.name ?? rel), mime: mimeOf(rel, a.mime), size: statSync(real).size, image: mimeOf(rel, a.mime).startsWith('image/'), relativePath: r } as Attachment;
    }
    const stored = String(a.storedPath ?? '');
    const real = (() => { try { return realpathSync(stored); } catch { return ''; } })();
    const r = relative(store, real);
    if (!real || !r || r.startsWith('..')) throw new DriverError('REJECTED', `附件副本已丢失：${a.name ?? ''}`);
    return { id: a.id, kind: 'file', name: safeName(a.name ?? 'attachment'), mime: mimeOf(stored, a.mime), size: statSync(real).size, image: mimeOf(stored, a.mime).startsWith('image/'), storedPath: real } as Attachment;
  });
}

/** 发给 Agent 的文字中注明附件：项目内文件给相对路径，项目外附件说明是副本。 */
export function attachmentNote(list: Attachment[]): string {
  if (!list.length) return '';
  const lines = list.map(a => a.kind === 'path' ? `- 项目文件：${a.relativePath}` : a.image ? `- 图片：${a.name}（已附上）` : `- 附件：${a.name}（项目外文件的副本：${a.storedPath}）`);
  return `\n\n附件：\n${lines.join('\n')}`;
}

export const readImageBase64 = (a: Attachment, cwd: string) => readFileSync(a.kind === 'path' ? join(cwd, a.relativePath!) : a.storedPath!).toString('base64');
