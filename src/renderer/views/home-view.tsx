import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { ProbeResult, Runner } from '@shared/types';
import { sessionsStore } from '@renderer/core/sessions-store';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';

export function HomeView() {
  const { t } = useTranslation();
  const [runner, setRunner] = useState<Runner>('claude');
  const [cwd, setCwd] = useState('');
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);

  const launch = async () => {
    setError('');
    setLaunching(true);
    try {
      await sessionsStore.launch({ runner, cwd: cwd.trim() });
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-8 py-12">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl">{t('home.title')}</h2>
          <p className="text-sm text-foreground-muted">{t('home.description')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('home.runner')}</Label>
          <Select value={runner} onValueChange={(v) => v && setRunner(v as Runner)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude Code</SelectItem>
              <SelectItem value="codex">Codex</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="home-cwd">{t('home.cwd')}</Label>
          <Input
            id="home-cwd"
            placeholder={t('home.cwdPlaceholder')}
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && cwd.trim() && void launch()}
          />
        </div>
        {error && <p className="text-sm text-foreground-destructive">{error}</p>}
        <div>
          <Button disabled={!cwd.trim() || launching} onClick={() => void launch()}>
            {t('home.launch')}
          </Button>
        </div>
        <Separator />
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">{t('home.probes')}</span>
            <Button variant="outline" size="sm" onClick={() => void rpc.probes.run().then(setProbes)}>
              {t('home.runProbes')}
            </Button>
          </div>
          {probes && (
            <div className="flex flex-col gap-1 font-mono text-xs">
              {probes.map((p) => (
                <div key={p.name} className={p.ok ? 'text-foreground-muted' : 'text-foreground-destructive'}>
                  {p.ok ? '✔' : '✘'} {p.name}：{p.detail}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
