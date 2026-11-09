import { agentAdapterMetadataSchema } from '@shared/agent-adapters';
const raw = import.meta.glob('@root/resources/agent-adapters/**/*',{ query: '?raw',import: 'default',eager: true }) as Record<string,string>;
const adapterAt = (id:string,version:string) => {
  const prefix = `/agent-adapters/${id}/${version}/`, sources = Object.fromEntries(Object.entries(raw).filter(([path]) => path.includes(prefix)).map(([path,text]) => [path.split(prefix)[1],text]));
  const metadata = agentAdapterMetadataSchema.parse(JSON.parse(sources['adapter.json']));
  const files = Object.fromEntries(Object.entries(sources).filter(([path]) => path !== 'adapter.json').map(([path,text]) => [path,Buffer.from(text,'utf8')]));
  return { metadata,files };
};
const adaptersAt = (version:string) => ['claude-code','codex'].map(id => adapterAt(id,version));

export const bundledAgentAdapters=()=>[...adaptersAt('1.0.0'),adapterAt('codex','1.2.0'),adapterAt('codex','1.3.0')];
export const bundledLegacyAgentAdapters=()=>adaptersAt('1.1.0');
