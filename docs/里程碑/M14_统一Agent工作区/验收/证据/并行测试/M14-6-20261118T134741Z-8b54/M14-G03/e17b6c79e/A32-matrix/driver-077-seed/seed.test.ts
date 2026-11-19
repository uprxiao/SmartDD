import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {expect,it} from 'vitest';
import {runBundledMigrations} from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/db/migrations';
import {openDbClient} from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/db/client';
import {SecretsStore} from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/secrets';
import {ResourceStore} from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/core/applications/resource-store';
import {MacProcessIdentityReader} from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/core/applications/process-identity';
import {pluginHostReadOnlyRoots} from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/core/applications/plugins/host-paths';
import {PluginHostService} from '/private/tmp/willyou-m14-stage6.WRvdST/source/src/main/core/applications/plugins/host-service';
import {buildPlugin,capability,manifest} from './build.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const privateAttempt=/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/(?:attempt-[0-9]+\/runtime-[a-zA-Z0-9]+|prep-next\/a32-recheck\/business\/seed-smoke-[a-zA-Z0-9]+)$/;
const shaFile=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
interface Fixture { root:string; executable:string; asarSha:string; commit:string }
function checkedContext():Fixture {
  const input=process.env.M14_A32_SEED_CONTEXT;
  if(!input||realpathSync(input)!==input||!privateAttempt.test(dirname(input))) throw Error('A32 seed needs an exact private context file');
  const spec=JSON.parse(readFileSync(input,'utf8')) as Fixture;
  if(dirname(input)!==spec.root||!privateAttempt.test(spec.root)||spec.executable!==join(base,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou')||
    realpathSync(spec.executable)!==spec.executable||!/^[0-9a-f]{64}$/.test(spec.asarSha)||!/^[0-9a-f]{40}$/.test(spec.commit)) throw Error('A32 seed received another App or root');
  if(readFileSync(join(base,'source-commit.txt'),'utf8').trim()!==spec.commit||
    shaFile(join(dirname(dirname(spec.executable)),'Resources/app.asar'))!==spec.asarSha) throw Error('A32 seed candidate mismatch');
  return spec;
}
it('seeds just the zero-connection test plugin in a new private db, through actual installation',async()=>{
  const spec=checkedContext();
  const data=join(spec.root,'data'),db=join(data,'smartdd.db'),appPath=join(dirname(dirname(spec.executable)),'Resources/app.asar');
  const appHelper=join(dirname(appPath),'native/willyou-process-identity');
  expect(realpathSync(data)).toBe(data);
  expect(existsSync(db)).toBe(false);
  expect(existsSync(join(data,'plugin-data'))).toBe(false);
  const keychainFence=join(spec.root,'home','Library','Keychains');
  mkdirSync(keychainFence,{recursive:true,mode:0o700});
  const packageSource=buildPlugin(join(spec.root,'fixture-plugin'));
  const client=openDbClient(db);
  let host:PluginHostService|undefined;
  try {
    runBundledMigrations(client.sqlite);
    const processes=new MacProcessIdentityReader(appHelper);
    const rejectSecret=()=>{throw Error('A32 fixture must not read or write any secret');};
    const secrets=new SecretsStore(client.db,{isAvailable:rejectSecret,encrypt:rejectSecret,decrypt:rejectSecret});
    const store=new ResourceStore(client.sqlite,data,undefined,{processes});
    host=new PluginHostService(store,secrets,{processes,runtime:{executable:spec.executable,
      readOnlyRoots:pluginHostReadOnlyRoots(appPath,spec.executable),keychainRoots:[keychainFence]}});
    const review=await host.inspect('local-a32-fixture',packageSource,'directory');
    expect(review.plan.appId).toBe(manifest.id);
    const installed=await host.install('local-a32-fixture',review.token);
    expect(installed).toMatchObject({appId:manifest.id,version:'0.1.0',installed:true,enabled:true});
    expect(installed.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(host.lifecycle.dataDirectory(manifest.id)).toBe(join(data,'plugin-data',manifest.id));
    expect(existsSync(join(host.lifecycle.dataDirectory(manifest.id),'effect.json'))).toBe(false);
    expect(client.sqlite.prepare('SELECT count(*) AS n FROM app_secrets').get()).toEqual({n:0});
    expect(client.sqlite.prepare('SELECT count(*) AS n FROM application_connections').get()).toEqual({n:0});
    writeFileSync(join(spec.root,'seed-witness.json'),JSON.stringify({schema:1,commit:spec.commit,asarSha:spec.asarSha,installed,capability,
      seedHasNoSecrets:true,seedHasNoConnections:true,seedHasNoEffects:true},null,2),{mode:0o600,flag:'wx'});
  }finally{
    await host?.close();
    client.close();
  }
},30000);
