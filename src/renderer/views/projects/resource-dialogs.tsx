import { useState } from 'react';
import { LoaderCircle, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import {
  DB_VENDOR_IDS,
  DB_VENDORS,
  ENV_PRESETS,
  isProdEnv,
  type ConnectionTestResult,
  type DatabaseInput,
  type DatabaseView,
  type DbVendor,
  type ServerInput,
  type ServerView,
} from '@shared/projects';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Field, PathInput, ProdWarning, SecretInput, secretChange, splitAliases, TestResultLine, type SecretDraft } from './form-parts';
import { FormDialog, useSave } from './project-dialogs';

const KEEP: SecretDraft = { mode: 'keep' };

function EnvInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Input id={id} list={`${id}-presets`} value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-presets`}>
        {ENV_PRESETS.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
    </>
  );
}

/** Test-connection button plus its last result; the test never saves anything. */
function useDraftTest(test: () => Promise<ConnectionTestResult>) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState('');
  const run = async () => {
    setTesting(true);
    setResult(null);
    setError('');
    try {
      setResult(await test());
    } catch (e) {
      // Input validation fails before any connection is made.
      setError(rpcErrorMessage(e));
    } finally {
      setTesting(false);
    }
  };
  const node = (
    <div className="flex min-w-0 items-start gap-3">
      <Button type="button" variant="outline" disabled={testing} onClick={() => void run()} data-testid="test-draft">
        {testing
          ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
          : <Plug className="size-4" strokeWidth={1.75} aria-hidden="true" />}
        {testing ? t('projects.actions.testing') : t('projects.actions.test')}
      </Button>
      <div className="min-w-0 pt-1.5">
        {result && <TestResultLine result={result} />}
        {error && <span className="text-xs break-all text-foreground-destructive">{error}</span>}
      </div>
    </div>
  );
  return node;
}

export function DatabaseDialog({
  open,
  onOpenChange,
  projectId,
  db,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  db?: DatabaseView;
}) {
  const { t } = useTranslation();
  const [env, setEnv] = useState(db?.env ?? 'dev');
  const [label, setLabel] = useState(db?.label ?? '');
  const [vendor, setVendor] = useState<DbVendor>(db?.vendor ?? 'mysql');
  const [host, setHost] = useState(db?.host ?? '');
  const [port, setPort] = useState(String(db?.port ?? DB_VENDORS.mysql.defaultPort));
  const [database, setDatabase] = useState(db?.database ?? '');
  const [schema, setSchema] = useState(db?.schema ?? '');
  const [username, setUsername] = useState(db?.username ?? '');
  const [password, setPassword] = useState<SecretDraft>(db ? KEEP : { mode: 'set', value: '' });
  const [accessLevel, setAccessLevel] = useState(db?.accessLevel ?? 'readonly');
  const [isDefault, setIsDefault] = useState(db?.isDefault ?? false);
  const [aliases, setAliases] = useState(db?.aliases.join(', ') ?? '');
  const [note, setNote] = useState(db?.note ?? '');
  const { busy, error, run } = useSave(onOpenChange);

  const input = (): DatabaseInput => ({
    env,
    label,
    aliases: splitAliases(aliases),
    vendor,
    host,
    port: Number(port),
    database,
    schema: DB_VENDORS[vendor].transport === 'postgres' ? schema || null : null,
    username,
    accessLevel,
    isDefault,
    note,
    password: secretChange(password),
  });
  const testNode = useDraftTest(() => rpc.databases.testDraft(input(), db?.id));

  const changeVendor = (next: DbVendor) => {
    // Follow the vendor's default port unless the user typed their own.
    if (port.trim() === '' || Number(port) === DB_VENDORS[vendor].defaultPort) setPort(String(DB_VENDORS[next].defaultPort));
    setVendor(next);
  };

  const submit = () =>
    void run(() => (db ? rpc.databases.update(db.id, input()) : rpc.databases.create(projectId, input())));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={db ? t('projects.dialog.editDatabase') : t('projects.dialog.newDatabase')}
      error={error}
      busy={busy}
      submitLabel={db ? t('projects.actions.save') : t('projects.actions.add')}
      onSubmit={submit}
      footerStart={testNode}
    >
      {isProdEnv(env) && <ProdWarning />}
      <div className="grid grid-cols-2 gap-4">
        <Field id="db-env" label={t('projects.fields.env')} hint={t('projects.fields.envHint')}>
          <EnvInput id="db-env" value={env} onChange={setEnv} />
        </Field>
        <Field id="db-label" label={t('projects.fields.label')}>
          <Input id="db-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t('projects.fields.vendor')}>
          <Select value={vendor} onValueChange={(v) => v && changeVendor(v as DbVendor)}>
            <SelectTrigger className="w-full" data-testid="db-vendor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DB_VENDOR_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {DB_VENDORS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field id="db-host" label={t('projects.fields.host')}>
            <Input id="db-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.5" />
          </Field>
          <Field id="db-port" label={t('projects.fields.port')}>
            <Input id="db-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
        </div>
        <Field id="db-database" label={t('projects.fields.database')}>
          <Input id="db-database" value={database} onChange={(e) => setDatabase(e.target.value)} />
        </Field>
        {DB_VENDORS[vendor].transport === 'postgres' ? (
          <Field id="db-schema" label={t('projects.fields.schema')} hint={t('projects.fields.schemaHint')}>
            <Input id="db-schema" value={schema} onChange={(e) => setSchema(e.target.value)} />
          </Field>
        ) : (
          <div />
        )}
        <Field id="db-username" label={t('projects.fields.username')}>
          <Input id="db-username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field id="db-password" label={t('projects.fields.password')}>
          <SecretInput id="db-password" saved={Boolean(db?.hasPassword)} draft={password} onChange={setPassword} />
        </Field>
        <Field label={t('projects.fields.accessLevel')}>
          <Select value={accessLevel} onValueChange={(v) => v && setAccessLevel(v as 'readonly' | 'readwrite')}>
            <SelectTrigger className="w-full" data-testid="db-access">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="readonly">{t('projects.fields.readonly')}</SelectItem>
              <SelectItem value="readwrite">{t('projects.fields.readwrite')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('projects.fields.isDefault')} hint={t('projects.fields.isDefaultHint')}>
          <div className="flex h-8 items-center">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} data-testid="db-default" />
          </div>
        </Field>
        <Field id="db-aliases" label={t('projects.fields.aliases')} hint={t('projects.fields.aliasesHint')}>
          <Input id="db-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        <Field id="db-note" label={t('projects.fields.note')}>
          <Textarea id="db-note" className="min-h-8" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}

type SudoPolicy = ServerView['sudoPolicy'];

export function ServerDialog({
  open,
  onOpenChange,
  projectId,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  server?: ServerView;
}) {
  const { t } = useTranslation();
  const [env, setEnv] = useState(server?.env ?? 'dev');
  const [label, setLabel] = useState(server?.label ?? '');
  const [host, setHost] = useState(server?.host ?? '');
  const [port, setPort] = useState(String(server?.port ?? 22));
  const [username, setUsername] = useState(server?.username ?? '');
  const [authType, setAuthType] = useState(server?.authType ?? 'password');
  const [password, setPassword] = useState<SecretDraft>(server ? KEEP : { mode: 'set', value: '' });
  const [privateKeyPath, setPrivateKeyPath] = useState(server?.privateKeyPath ?? '');
  const [passphrase, setPassphrase] = useState<SecretDraft>(server ? KEEP : { mode: 'set', value: '' });
  const [sudoPolicy, setSudoPolicy] = useState<SudoPolicy>(server?.sudoPolicy ?? 'none');
  const [sudoPassword, setSudoPassword] = useState<SecretDraft>(server ? KEEP : { mode: 'set', value: '' });
  const [defaultRoot, setDefaultRoot] = useState(server?.defaultRoot ?? false);
  const [appRoot, setAppRoot] = useState(server?.appRoot ?? '');
  const [logsPath, setLogsPath] = useState(server?.logsPath ?? '');
  const [aliases, setAliases] = useState(server?.aliases.join(', ') ?? '');
  const [note, setNote] = useState(server?.note ?? '');
  const { busy, error, run } = useSave(onOpenChange);

  const input = (): ServerInput => ({
    env,
    label,
    aliases: splitAliases(aliases),
    host,
    port: Number(port),
    username,
    authType,
    privateKeyPath: privateKeyPath || null,
    defaultRoot,
    sudoPolicy,
    appRoot: appRoot || null,
    logsPath: logsPath || null,
    note,
    password: secretChange(password),
    passphrase: secretChange(passphrase),
    // A separate sudo password only exists under the 'separate' policy.
    sudoPassword: sudoPolicy === 'separate' ? secretChange(sudoPassword) : server?.hasSudoPassword ? null : undefined,
  });
  const testNode = useDraftTest(() => rpc.servers.testDraft(input(), server?.id));

  const submit = () =>
    void run(() => (server ? rpc.servers.update(server.id, input()) : rpc.servers.create(projectId, input())));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={server ? t('projects.dialog.editServer') : t('projects.dialog.newServer')}
      error={error}
      busy={busy}
      submitLabel={server ? t('projects.actions.save') : t('projects.actions.add')}
      onSubmit={submit}
      footerStart={testNode}
    >
      {isProdEnv(env) && <ProdWarning />}
      <div className="grid grid-cols-2 gap-4">
        <Field id="srv-env" label={t('projects.fields.env')} hint={t('projects.fields.envHint')}>
          <EnvInput id="srv-env" value={env} onChange={setEnv} />
        </Field>
        <Field id="srv-label" label={t('projects.fields.label')}>
          <Input id="srv-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field id="srv-host" label={t('projects.fields.host')}>
            <Input id="srv-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.8" />
          </Field>
          <Field id="srv-port" label={t('projects.fields.port')}>
            <Input id="srv-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
        </div>
        <Field id="srv-username" label={t('projects.fields.username')}>
          <Input id="srv-username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label={t('projects.fields.authType')}>
          <Select value={authType} onValueChange={(v) => v && setAuthType(v as 'password' | 'key')}>
            <SelectTrigger className="w-full" data-testid="srv-auth">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="password">{t('projects.fields.authPassword')}</SelectItem>
              <SelectItem value="key">{t('projects.fields.authKey')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {authType === 'password' ? (
          <Field id="srv-password" label={t('projects.fields.password')}>
            <SecretInput id="srv-password" saved={Boolean(server?.hasPassword)} draft={password} onChange={setPassword} />
          </Field>
        ) : (
          <Field id="srv-key" label={t('projects.fields.privateKeyPath')}>
            <PathInput id="srv-key" kind="file" value={privateKeyPath} onChange={setPrivateKeyPath} placeholder="~/.ssh/id_ed25519" />
          </Field>
        )}
        {authType === 'key' && (
          <>
            <div />
            <Field id="srv-passphrase" label={t('projects.fields.passphrase')}>
              <SecretInput id="srv-passphrase" saved={Boolean(server?.hasPassphrase)} draft={passphrase} onChange={setPassphrase} />
            </Field>
          </>
        )}
        <Field label={t('projects.fields.sudoPolicy')}>
          <Select value={sudoPolicy} onValueChange={(v) => v && setSudoPolicy(v as SudoPolicy)}>
            <SelectTrigger className="w-full" data-testid="srv-sudo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('projects.fields.sudoNone')}</SelectItem>
              <SelectItem value="same-as-login">{t('projects.fields.sudoSame')}</SelectItem>
              <SelectItem value="separate">{t('projects.fields.sudoSeparate')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {sudoPolicy === 'separate' ? (
          <Field id="srv-sudo-password" label={t('projects.fields.sudoPassword')}>
            <SecretInput
              id="srv-sudo-password"
              saved={Boolean(server?.hasSudoPassword)}
              draft={sudoPassword}
              onChange={setSudoPassword}
            />
          </Field>
        ) : (
          <div />
        )}
        <Field label={t('projects.fields.defaultRoot')}>
          <div className="flex h-8 items-center">
            <Switch checked={defaultRoot} onCheckedChange={setDefaultRoot} />
          </div>
        </Field>
        <div />
        <Field id="srv-app" label={t('projects.fields.appRoot')}>
          <Input id="srv-app" value={appRoot} onChange={(e) => setAppRoot(e.target.value)} placeholder="/opt/app" />
        </Field>
        <Field id="srv-logs" label={t('projects.fields.logsPath')}>
          <Input id="srv-logs" value={logsPath} onChange={(e) => setLogsPath(e.target.value)} placeholder="/opt/app/logs" />
        </Field>
        <Field id="srv-aliases" label={t('projects.fields.aliases')} hint={t('projects.fields.aliasesHint')}>
          <Input id="srv-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        <Field id="srv-note" label={t('projects.fields.note')}>
          <Textarea id="srv-note" className="min-h-8" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}
