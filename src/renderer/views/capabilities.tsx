import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { DiscoveredCapability, RuntimeSnapshot } from '@shared/capabilities';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { useAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';

const issueLabels: Record<string, [string, string]> = {
  file_hash_mismatch: ['投影内容已改变，请重新启动任务', 'Projection changed; restart the task'],
  file_unreadable: ['投影文件不可读取', 'Projection file unreadable'],
  manifest_invalid: ['投影清单无效', 'Invalid projection manifest'],
  manifest_hash_mismatch: ['投影清单已改变', 'Projection manifest changed'],
  resource_path_unreadable: ['私钥等资源文件不可读取', 'Resource file (such as a private key) unreadable'],
  runner_not_found: ['终端中找不到 CLI，请检查 AI 配置', 'CLI not found in terminal; check the AI profile'],
  self_check_timeout: ['终端自检超时，启动已停止', 'Terminal check timed out; launch stopped'],
  self_check_not_received: ['未收到终端自检结果，请检查 Python 3 和终端输出', 'No terminal check result; check Python 3 and terminal output'],
  self_check_report_invalid: ['终端自检结果无效', 'Invalid terminal check result'],
  runtime_dependencies_unverified: ['运行依赖待核验', 'Runtime dependencies unverified'],
  project_trust_unverified: ['项目信任/审批待核验', 'Project trust/approval unverified'],
  command_path_unverified: ['命令路径待终端检查', 'Command path needs a terminal check'],
  network_auth_unverified: ['网络及认证待核验', 'Network/authentication unverified'],
  config_parse_failed: ['配置解析失败', 'Configuration could not be parsed'],
  config_shape_invalid: ['配置结构无效，应为对象', 'Invalid configuration structure; expected an object'],
  skill_parse_failed: ['Skill 文档解析失败', 'Skill document could not be parsed'],
  skill_metadata_missing: ['缺少 name 或 description', 'Missing name or description'],
  path_unreadable: ['路径不可读取', 'Path unreadable'],
  mcp_command_missing: ['缺少启动命令', 'Missing command'],
  mcp_args_invalid: ['参数格式无效', 'Invalid argument format'],
  mcp_env_invalid: ['环境变量格式无效', 'Invalid environment format'],
  mcp_url_invalid: ['服务地址格式无效', 'Invalid server address'],
};

function issueText(issue: string, en: boolean): string {
  if (issueLabels[issue]) return issueLabels[issue][en ? 1 : 0];
  const [code, name] = issue.split(':');
  const labels: Record<string, [string, string]> = {
    missing_dependency: ['缺少 Python 依赖', 'Missing Python dependency'],
    missing_env: ['缺少环境变量', 'Missing environment variable'],
    wrong_path_env: ['配置环境变量不匹配', 'Configuration environment mismatch'],
    missing_command: ['缺少系统命令', 'Missing system command'],
  };
  return labels[code] ? `${labels[code][en ? 1 : 0]}: ${name}` : issue;
}

export function InjectionFailure({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const { t, i18n } = useTranslation();
  return <div role="alert" data-testid="injection-failure" className="border-b border-border bg-background-2 px-4 py-2 text-sm text-foreground-destructive">
    <span className="font-medium">{t('capabilities.check.failed')}</span> · {snapshot.selfCheck.issues.map((s) => issueText(s, i18n.language.startsWith('en'))).join('；')}
  </div>;
}

function DiscoveryList({ items }: { items: DiscoveredCapability[] }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language.startsWith('en');
  const [filter, setFilter] = useState('');
  const shown = items.filter((r) => `${r.name} ${r.kind} ${r.source}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="flex flex-col gap-3" data-testid="capability-discovery">
    <input className="rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none" aria-label={t('capabilities.filter')} placeholder={t('capabilities.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
    <p className="text-xs text-foreground-muted">{t('capabilities.discoveryHint', { count: items.length })}</p>
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-background-2 text-foreground-muted"><tr>
          <th className="p-3">{t('capabilities.name')}</th><th className="p-3">{t('capabilities.source')}</th><th className="p-3">{t('capabilities.validation')}</th><th className="p-3">{t('capabilities.loading')}</th>
        </tr></thead>
        <tbody>{shown.map((r) => <tr key={r.id} className="border-t border-border align-top">
          <td className="max-w-52 p-3 break-all"><span className="font-medium">{r.name}</span><div className="mt-1 text-foreground-passive">{r.kind} · {r.runner}{r.version ? ` · ${r.version}` : ''}</div>{r.enabled === false && <span>{t('capabilities.disabled')}</span>}</td>
          <td className="max-w-72 p-3 break-all text-foreground-muted"><div>{r.source}</div><code className="select-text">{r.path}</code></td>
          <td className="max-w-52 p-3"><div className={r.validity === 'invalid' ? 'text-foreground-destructive' : ''}>{t(`capabilities.validity.${r.validity}`)}</div>{r.issues.map((issue) => <div key={issue} className="mt-1 text-foreground-passive">{issueLabels[issue]?.[en ? 1 : 0] ?? issue}</div>)}{r.envNames.length > 0 && <div className="mt-1 break-all text-foreground-passive">{r.envNames.join(', ')}</div>}</td>
          <td className="p-3 text-foreground-passive">{t('capabilities.unverified')}</td>
        </tr>)}</tbody>
      </table>
      {shown.length === 0 && <p className="p-4 text-sm text-foreground-passive">{t('capabilities.none')}</p>}
    </div>
  </div>;
}

export function CapabilitiesSection({ projectId }: { projectId?: string }) {
  const { t } = useTranslation();
  const query = useQueryClient();
  const { data: profiles = [] } = useAiProfiles();
  const [profileId, setProfileId] = useState<string | null>(null);
  const selected = profiles.find((p) => p.id === profileId) ?? profiles.find((p) => p.isDefault) ?? profiles[0];
  const [busy, setBusy] = useState(false);
  const catalog = useQuery({ queryKey: ['capabilities', 'catalog', projectId], queryFn: () => projectId ? rpc.capabilities.projectSettings(projectId) : rpc.capabilities.list().then((skills) => ({ skills, mcpEnabled: true })) });
  const scan = useQuery({ queryKey: ['capabilities', 'scan', projectId, selected?.id], queryFn: () => rpc.capabilities.preview({ projectId, aiProfileId: selected!.id }), enabled: Boolean(selected), staleTime: 30_000 });
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await query.invalidateQueries({ queryKey: ['capabilities'] }); await query.invalidateQueries({ queryKey: ['projects'] }); await query.invalidateQueries({ queryKey: ['project'] }); }
    catch (e) { toast.error(rpcErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return <div className="flex flex-col gap-6" data-testid="capabilities-section">
    <p className="text-sm text-foreground-muted">{t('capabilities.standardHint')}</p>
    {catalog.error && <p className="text-sm text-foreground-destructive">{rpcErrorMessage(catalog.error)}</p>}
    {catalog.data?.skills.map((s) => <div key={s.id} className="flex flex-wrap items-start gap-4 rounded-lg border border-border p-4">
      <div className="min-w-48 flex-1 text-sm"><div className="font-medium">{s.name} <span className="font-mono text-xs text-foreground-muted">v{s.current.version}</span></div>
        <div className="mt-1 text-xs text-foreground-muted">{s.source}</div>
        <details className="mt-2 text-xs text-foreground-passive"><summary className="cursor-pointer">{t('capabilities.versions', { count: s.versions.length })}</summary>{s.versions.map((v) => <div key={v.id} className="mt-1 font-mono break-all">{v.version} · {v.hash.slice(0, 16)} · {new Date(v.installedAt).toLocaleString()}{v.active ? ` · ${t('capabilities.current')}` : ''}</div>)}</details>
      </div>
      {projectId ? <Switch aria-label={s.name} checked={s.enabled} disabled={busy} onCheckedChange={(enabled) => void act(() => rpc.capabilities.setEnabled(projectId, s.id, enabled))} /> : <Button size="sm" variant="outline" disabled={busy || !s.updateAvailable} onClick={() => void act(() => rpc.capabilities.upgrade(s.id))}>{s.updateAvailable ? t('capabilities.upgrade', { version: s.availableVersion }) : t('capabilities.upToDate')}</Button>}
    </div>)}
    {projectId && <div className="flex items-center gap-4 rounded-lg border border-border p-4"><div className="flex-1 text-sm"><div className="font-medium">{t('capabilities.contextMcp')}</div><p className="mt-1 text-xs text-foreground-muted">{t('capabilities.contextHint')}</p></div><Switch aria-label={t('capabilities.contextMcp')} checked={catalog.data?.mcpEnabled ?? true} disabled={busy || !catalog.data} onCheckedChange={(enabled) => void act(() => rpc.capabilities.setEnabled(projectId, 'smartdd-project-context', enabled))} /></div>}
    <div className="flex items-center justify-between gap-3">
      <Select value={selected?.id ?? null} onValueChange={(v) => setProfileId(v as string)}><SelectTrigger className="max-w-72"><SelectValue placeholder={t('capabilities.selectProfile')} /></SelectTrigger><SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.runner}</SelectItem>)}</SelectContent></Select>
      <Button size="sm" variant="outline" disabled={!selected || scan.isFetching} onClick={() => void scan.refetch()}>{scan.isFetching ? t('capabilities.scanning') : t('capabilities.refresh')}</Button>
    </div>
    {scan.error && <p className="text-sm text-foreground-destructive">{rpcErrorMessage(scan.error)}</p>}
    {scan.data?.issues.map((s) => <p key={s} className="text-sm text-foreground-destructive">{s}</p>)}
    {scan.data && <DiscoveryList items={scan.data.discovered} />}
    {!selected && <p className="text-sm text-foreground-muted">{t('capabilities.selectProfile')}</p>}
  </div>;
}

export function CapabilityLaunchPreview({ projectId, aiProfileId, cwd }: { projectId: string; aiProfileId: string; cwd: string }) {
  const { t } = useTranslation();
  const scan = useQuery({ queryKey: ['capabilities', 'launch', projectId, aiProfileId, cwd], queryFn: () => rpc.capabilities.preview({ projectId, aiProfileId, cwd }), staleTime: 15_000 });
  return <details className="mt-3 text-xs text-foreground-muted" data-testid="capability-launch-preview"><summary className="cursor-pointer">{t('capabilities.launchPreview')} · {scan.isFetching ? t('capabilities.scanning') : t('capabilities.unverified')}</summary>
    {scan.error && <p className="mt-2 text-foreground-destructive">{rpcErrorMessage(scan.error)}</p>}
    {scan.data && <div className="mt-2 flex flex-col gap-2">
      <p>{scan.data.skills.filter((s) => s.enabled).map((s) => `${s.name} v${s.current.version}`).join(' · ') || t('capabilities.none')}{scan.data.mcpEnabled ? ' · SmartDD MCP' : ''}</p>
      <p>{t('capabilities.previewHint', { count: scan.data.discovered.length })}</p>
      {scan.data.issues.map((s) => <p key={s} className="text-foreground-destructive">{s}</p>)}
    </div>}
  </details>;
}

export function RuntimeCapabilities({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const { t, i18n } = useTranslation();
  return <div className="flex flex-col gap-1.5" data-testid="runtime-capabilities">
    <div className={snapshot.selfCheck.status === 'failed' ? 'text-foreground-destructive' : ''}>{t('capabilities.injection')}：{t(`capabilities.check.${snapshot.selfCheck.status}`)}</div>
    {snapshot.selfCheck.issues.map((s) => <div key={s} className="break-all text-foreground-destructive">{issueText(s, i18n.language.startsWith('en'))}</div>)}
    <div className="font-mono text-foreground-passive">v{snapshot.configVersion} · {snapshot.configHash.slice(0, 16)}</div>
    <details className="text-foreground-passive"><summary className="cursor-pointer">{t('capabilities.audit')}</summary><code className="break-all select-text">{snapshot.auditPath}</code></details>
    {snapshot.skills.filter((s) => s.enabled).map((s) => <div key={s.versionId} title={s.path}>{s.name} {s.version} · {t('capabilities.unverified')}</div>)}
    {snapshot.mcp.map((m) => <div key={m.name} className="break-all">{m.name} · {t('capabilities.unverified')}</div>)}
  </div>;
}
