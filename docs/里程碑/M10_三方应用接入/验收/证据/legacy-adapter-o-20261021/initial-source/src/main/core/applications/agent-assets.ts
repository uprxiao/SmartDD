import { agentAdapterMetadataSchema } from '@shared/agent-adapters';
const raw = import.meta.glob('@root/resources/agent-adapters/**/*',{ query: '?raw',import: 'default',eager: true }) as Record<string,string>;
export const bundledAgentAdapters = () => ['claude-code','codex'].map(id => {
  const prefix = `/agent-adapters/${id}/1.0.0/`, sources = Object.fromEntries(Object.entries(raw).filter(([path]) => path.includes(prefix)).map(([path,text]) => [path.split(prefix)[1],text]));
  const metadata = agentAdapterMetadataSchema.parse(JSON.parse(sources['adapter.json']));
  const files = Object.fromEntries(Object.entries(sources).filter(([path]) => path !== 'adapter.json').map(([path,text]) => [path,Buffer.from(text,'utf8')]));
  return { metadata,files };
});
