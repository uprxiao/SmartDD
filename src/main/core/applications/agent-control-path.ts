import {ApplicationError} from '@shared/applications';

/** Reserved by the host for per-run native Agent control sockets. Plugins must
 * never connect here, including plugins started before a new run is created.
 * Endpoint creation must separately validate directory owner, mode and identity.
 */
export function agentControlRootPath():string {
  const uid=process.getuid?.();
  if(process.platform!=='darwin'||!Number.isSafeInteger(uid)||uid!<0)throw new ApplicationError('HOST_INCOMPATIBLE','当前平台尚未验证私有 Agent 控制端点');
  return '/private/tmp/wy-agent-control-'+uid;
}

/** Codex 0.167.1 uses a guarded rendezvous symlink even for custom --listen
 * paths. Match the pinned codex-uds physical namespace, not HOME/TMPDIR. */
export function codexDaemonRootPath():string {
  agentControlRootPath();return '/private/tmp/codex-daemon-'+process.getuid!();
}
