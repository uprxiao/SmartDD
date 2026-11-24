import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { AgentCommandPreview } from '@shared/events';

const POLL_MS = 250;
const DISCOVERY_POLLS = 40;
const MAX_FILES = 32;
const TAIL_BYTES = 12 * 1024;
const safeId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);

type OutputFile = {
  root: string;
  sessionId: string;
  taskId: string;
  file?: string;
  stamp?: string;
  attempts: number;
  preview?: AgentCommandPreview;
  pending?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
};

/** Claude's SDK returns foreground output with the result. Follow its Bash file for the live preview. */
export class ClaudeTaskOutputs {
  private readonly files = new Map<string, OutputFile>();
  private revision = 0;

  constructor(private readonly publish: (toolId: string, preview: AgentCommandPreview) => void) {}

  start(toolId: string, sessionId: string, taskId: string, cwd: string, env: Record<string, string>) {
    const uid = process.getuid?.();
    if (uid === undefined || !safeId(sessionId) || !safeId(taskId) || !safeId(toolId) || this.files.size >= MAX_FILES || this.files.has(toolId)) return;
    const fallback = process.platform === 'darwin' ? '/tmp' : env.TMPDIR || env.TMP || env.TEMP || '/tmp';
    const root = resolve(cwd, env.CLAUDE_CODE_TMPDIR?.trim() || fallback, `claude-${uid}`);
    const entry = { root, sessionId, taskId, attempts: 0 };
    this.files.set(toolId, entry);
    this.poll(toolId, entry);
  }

  preview(toolId: string) { return this.files.get(toolId)?.preview; }

  stop(toolId: string) {
    const entry = this.files.get(toolId);
    clearTimeout(entry?.timer);
    this.files.delete(toolId);
    return entry;
  }

  async finish(toolId: string) {
    const entry = this.stop(toolId);
    if (!entry) return;
    await entry.pending;
    await this.sample(entry);
    return entry.preview;
  }

  close() { for (const toolId of this.files.keys()) this.stop(toolId); }

  private poll(toolId: string, entry: OutputFile) {
    const previous = entry.preview;
    entry.pending = this.sample(entry).then(() => {
      if (this.files.get(toolId) !== entry) return;
      if (entry.preview && entry.preview !== previous) this.publish(toolId, entry.preview);
      if (!entry.file && entry.attempts >= DISCOVERY_POLLS) return;
      entry.timer = setTimeout(() => this.poll(toolId, entry), POLL_MS);
      entry.timer.unref();
    });
  }

  private async locate(entry: OutputFile) {
    entry.attempts++;
    const root = await realpath(entry.root);
    for (const project of await readdir(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const candidate = join(root, project.name, entry.sessionId, 'tasks', `${entry.taskId}.output`);
      if (await realpath(candidate).catch(() => undefined) === candidate) return candidate;
    }
  }

  private async sample(entry: OutputFile) {
    try {
      entry.file ??= await this.locate(entry);
      if (!entry.file || await realpath(entry.file) !== entry.file) return;
      // This is an owned Bash log. In particular, never follow a native Agent's transcript symlink.
      const file = await open(entry.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await file.stat();
        const stamp = `${info.ino}:${info.mtimeMs}:${info.size}`;
        if (!info.isFile() || stamp === entry.stamp) return;
        const offset = Math.max(0, info.size - TAIL_BYTES);
        const buffer = Buffer.alloc(info.size - offset);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        if (bytesRead !== buffer.length) return;
        entry.stamp = stamp;
        let start = 0;
        if (offset) while (start < bytesRead && (buffer[start] & 0xc0) === 0x80) start++;
        const decoded = new TextDecoder().decode(buffer.subarray(start), { stream: true });
        const text = stripVTControlCharacters(decoded).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        const truncated = offset > 0;
        if ((!entry.preview && !text) || (text === entry.preview?.text && truncated === entry.preview.truncated)) return;
        entry.preview = { revision: ++this.revision, text, truncated };
      } finally {
        await file.close();
      }
    } catch { /* Files can appear late or disappear before the final native result. */ }
  }
}
