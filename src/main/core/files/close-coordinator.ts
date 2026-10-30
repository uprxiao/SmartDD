import { randomUUID } from 'node:crypto';
import { FileError, fileCloseReplySchema, type FileCloseReply, type FileCloseRequest } from '@shared/files';

export class FileCloseCoordinator {
  private readonly pending = new Map<string, { owner: string; finish: (reply: FileCloseReply) => void }>();
  request(owner: string, action: 'save' | 'discard' | 'commit', send: (request: FileCloseRequest) => void): Promise<FileCloseReply> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => finish({ id, ready: false, failures: [{ name: '文件工作区', message: '尚未收到文件保存确认，现有修改及恢复材料保留；请继续查看后重试' }] }), 30000);
      const finish = (reply: FileCloseReply) => { if (!this.pending.has(id)) return; this.pending.delete(id); clearTimeout(timeout); resolve(reply); };
      this.pending.set(id, { owner, finish });
      try { send({ id, action }); } catch { finish({ id, ready: false, failures: [{ name: '文件工作区', message: '无法联系原文件界面，未确认退出保存' }] }); }
    });
  }
  answer(owner: string, input: FileCloseReply): void {
    const reply = fileCloseReplySchema.parse(input), pending = this.pending.get(reply.id);
    if (!pending || pending.owner !== owner) throw new FileError('UNTRUSTED', '退出回执不属于当前窗口或已过期');
    if (reply.ready && reply.failures.length) throw new FileError('INVALID_INPUT', '退出回执仍包含未解决文件');
    pending.finish(reply);
  }
  closeOwner(owner: string): void {
    for (const [id, pending] of this.pending) if (pending.owner === owner) pending.finish({ id, ready: false, failures: [{ name: '文件工作区', message: '保存确认期间原界面已关闭或重新载入' }] });
  }
}
