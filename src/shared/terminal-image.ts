import { z } from 'zod';

export const TERMINAL_IMAGE_LIMITS = { bytes: 20 * 1024 * 1024, cachedBytes: 80 * 1024 * 1024, cachedImages: 64 } as const;
export interface TerminalImageCapability {
  state: 'supported' | 'unsupported' | 'unknown'; reason: string;
  adapterId?: string; acceptedMimeTypes: string[];
}
// Main-only child report: never expose executable paths or arbitrary CLI args to
// the renderer. The hash pins the version whose real image draft was verified.
export const imageInputLaunchSchema = z.object({
  runId: z.string().min(1).max(128), pid: z.number().int().positive(),
  executable: z.string().min(1).max(8192), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  device: z.string(), inode: z.string(), size: z.number().int().positive(), mtimeNs: z.string(),
  mode: z.enum(['interactive', 'noninteractive', 'unknown']),
}).strict();
export type ImageInputLaunch = z.infer<typeof imageInputLaunchSchema>;
export const CLAUDE_PNG_ADAPTER = {
  sha256: 'b5d795b7760032d79954b55a9cd1876dcf3a8dc9608fd6bb9f618593f69fd44b',
  bytes: 272984176,
  id: 'claude-code-2.1.306-png-paste',
} as const;
export function imageInputMode(args: string[]): ImageInputLaunch['mode'] {
  const flags = new Set(['--bare', '--strict-mcp-config', '--no-chrome']);
  const values = new Set(['--session-id', '--resume', '--append-system-prompt', '--mcp-config', '--plugin-dir', '--tools', '--setting-sources']);
  const noninteractive = new Set(['-p', '--print', '--version', '-v', '--help', '-h', '--input-format', '--output-format']);
  for (let at = 0; at < args.length;) {
    const arg = args[at];
    if (noninteractive.has(arg)) return 'noninteractive';
    if (flags.has(arg)) at++;
    else if (values.has(arg) && at + 1 < args.length) at += 2;
    else if (at === args.length - 1 && arg && !arg.startsWith('-')) at++;
    else return 'unknown';
  }
  return 'interactive';
}
export function imageInputCapability(launch: ImageInputLaunch | null): TerminalImageCapability {
  if (!launch) return { state: 'unknown', reason: '当前 CLI 的实际启动身份尚未确认，未附加图片。', acceptedMimeTypes: [] };
  if (launch.sha256 !== CLAUDE_PNG_ADAPTER.sha256) return { state: 'unknown', reason: '当前 CLI 版本尚未验证图片输入，未附加图片。', acceptedMimeTypes: [] };
  if (launch.mode === 'noninteractive') return { state: 'unsupported', reason: '当前 CLI 以非交互模式启动，不支持图片输入草稿。', acceptedMimeTypes: [] };
  if (launch.mode !== 'interactive') return { state: 'unknown', reason: '当前 CLI 启动方式尚未验证图片输入，未附加图片。', acceptedMimeTypes: [] };
  return { state: 'supported', reason: '支持静态 PNG 图片输入草稿（最多 20 MiB、1600 万像素）；插入后请在终端检查。', adapterId: CLAUDE_PNG_ADAPTER.id, acceptedMimeTypes: ['image/png'] };
}
export function terminalImageData(path: string): string {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('/../')) throw new Error('图片输入缓存路径不可安全投递');
  return `\x1b[200~${path}\x1b[201~`;
}
