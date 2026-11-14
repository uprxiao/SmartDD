import { z } from 'zod';
import type { CodeAgentKind } from './ai-agents';

export const agentPermissionSchema = z.enum(['ask', 'auto', 'full']);
export type AgentPermission = z.infer<typeof agentPermissionSchema>;
const args: Record<CodeAgentKind, Partial<Record<AgentPermission, readonly string[]>>> = {
  codex: { ask: ['-s', 'workspace-write', '-a', 'on-request', '-c', 'approvals_reviewer="user"'],
    auto: ['--approve-for-me'], full: ['--dangerously-bypass-approvals-and-sandbox'] },
  claude: { ask: ['--permission-mode', 'default'], full: ['--permission-mode', 'bypassPermissions'] },
};

/** Unsupported remembered choices fall back without changing the remembered value. */
export function agentPermission(kind: CodeAgentKind, selected: AgentPermission): { id: AgentPermission; args: string[] } {
  agentPermissionSchema.parse(selected);
  const id = args[kind][selected] ? selected : 'ask';
  return { id, args: [...args[kind][id]!] };
}

/** Exact 0.167.1 CLI shorthand -> config semantics, for the private app-server.
 * https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/utils/cli/src/shared_options.rs
 * Parse argv positions, never flags embedded in a config value or MCP argument.
 */
export function expandCodexPermissionShorthands(source: readonly string[]): string[] {
  const output: string[] = [];
  let shortcut: 'auto' | 'full' | null = null, explicit = false;
  for (let index = 0; index < source.length; index++) {
    const value = source[index], flag = value.split('=', 1)[0];
    if (value === '--approve-for-me' || value === '--dangerously-bypass-approvals-and-sandbox') {
      if (shortcut || explicit) throw new Error('Codex 权限档位参数冲突');
      shortcut = value === '--approve-for-me' ? 'auto' : 'full';
      output.push(...(shortcut === 'auto' ? ['-c', 'approvals_reviewer="auto_review"', '-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="workspace-write"'] :
        ['-c', 'approval_policy="never"', '-c', 'sandbox_mode="danger-full-access"']));
    } else {
      if (['-s', '--sandbox', '-a', '--ask-for-approval'].includes(flag)) {
        if (shortcut) throw new Error('Codex 权限档位参数冲突');
        explicit = true;
      }
      output.push(value);
      if (!value.includes('=') && ['-c', '--config', '--enable', '--disable', '-m', '--model', '-s', '--sandbox', '-a', '--ask-for-approval'].includes(flag)) {
        if (index + 1 < source.length) output.push(source[++index]);
      }
    }
  }
  return output;
}
