import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { agentExportSelectionSchema, portableAgentsSchema, type AgentExportSelection, type AgentImportPreview, type AgentImportResult, type PortableAgents } from '@shared/agent-transfer';
import { isSecretEnvName } from '@shared/ai-profiles';
import { publicLocalMagpie } from '@shared/ai-provider-presets';
import { passphraseIssue, TRANSFER_LIMITS } from '@shared/project-transfer';
import type { AppDb } from '../../db/client';
import { aiProfiles, aiProviders, aiRunConfigs, aiTools } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import { decryptTransfer, encryptTransfer, inspectEnvelope, strictJson } from '../projects/transfer-format';
import { atomicWrite, readLimited } from '../projects/transfer-files';
import type { AgentService } from './agent-service';
import type { ProviderService } from './provider-service';

export class AgentTransferError extends Error {}

const localPath = (value: string) => /(?:^|[=\s"'])(?:~[/\\]|\.{1,2}[/\\]|[A-Za-z]:[\\/]|\/(?!\/))/.test(value) && !/^https?:\/\//.test(value);
const importedName = (name: string, used: Set<string>, max: number) => {
  if (!used.has(name)) { used.add(name); return name; }
  for (let i=1; ; i++) { const suffix=i===1?'（导入）':`（导入 ${i}）`, next=name.slice(0,max-suffix.length)+suffix;
    if (!used.has(next)) { used.add(next); return next; } }
};
function validate(input: unknown, encrypted: boolean): PortableAgents {
  const p=portableAgentsSchema.parse(input), refs=new Set<string>(), providers=new Map(p.providers.map(x=>[x.ref,x]));
  const use=(ref:string)=>{if(refs.has(ref))throw new AgentTransferError('配置文件包含重复标识');refs.add(ref);};
  for(const item of p.providers){ use(item.ref); const ids=new Set<string>(); for(const m of item.models){if(ids.has(m.id))throw new AgentTransferError('模型 ID 重复');ids.add(m.id);} }
  const combinations=new Set<string>();
  for(const item of p.agents){
    use(item.ref);
    if(item.source==='provider'){
      const provider=providers.get(item.provider), protocol=item.kind==='claude'?'anthropic':'responses';
      if(!provider?.endpoints[protocol])throw new AgentTransferError('智能体引用的供应商或协议缺失');
      if(!item.models.includes(item.defaultModel)||new Set(item.models).size!==item.models.length||item.models.some(id=>!provider.models.some(m=>m.id===id)))throw new AgentTransferError('智能体的模型引用无效');
      const key=`${item.kind}:${item.provider}`;if(combinations.has(key))throw new AgentTransferError('文件包含重复的智能体组合');combinations.add(key);
    }else if(item.source==='legacy'){
      const names=new Set<string>();
      for(const entry of item.env){
        if(names.has(entry.name)||(!entry.secret&&(entry.value===null||isSecretEnvName(entry.name)))||(entry.secret&&entry.value!==null))throw new AgentTransferError('高级配置环境变量无效');
        if(entry.value&&localPath(entry.value))throw new AgentTransferError('高级配置包含本机目录，请移除目录字段后再导出');names.add(entry.name);
      }
      if(item.args.some(localPath))throw new AgentTransferError('高级配置参数包含本机目录，请移除目录参数后再导出');
    }
  }
  if(!encrypted&&Object.keys(p.credentials).length)throw new AgentTransferError('含 Key 的配置必须使用口令加密');
  for(const [ref,c] of Object.entries(p.credentials)){
    const provider=providers.get(ref), agent=p.agents.find(a=>a.ref===ref);
    if(provider){if(c.env||!c.key)throw new AgentTransferError('供应商凭据引用无效');}
    else if(agent?.source==='legacy'){
      if(c.key||!c.env||Object.keys(c.env).some(name=>!agent.env.some(e=>e.secret&&e.name===name)))throw new AgentTransferError('高级配置凭据引用无效');
    }else throw new AgentTransferError('凭据引用不存在');
  }
  const visible=JSON.stringify({...p,credentials:{}});
  const keys=Object.values(p.credentials).flatMap(c=>[c.key,...Object.values(c.env??{})]).filter((key):key is string=>Boolean(key));
  if(keys.some(key=>[key,encodeURIComponent(key),JSON.stringify(key).slice(1,-1)].some(form=>visible.includes(form))))throw new AgentTransferError('配置的公开字段包含凭据，已拒绝导入或导出');
  return p;
}
interface Pending { owner:number; expires:number; raw:Buffer; payload?:PortableAgents; preview?:AgentImportPreview; result?:AgentImportResult }

/** File bytes and decrypted credentials remain in main. Renderer receives only
 * bounded descriptive previews and an owner-bound opaque commit token. */
export class AgentTransferService {
  private readonly pending=new Map<string,Pending>();
  private readonly generations=new Map<number,number>();
  constructor(private readonly db:AppDb,private readonly secrets:SecretsStore,private readonly agents:AgentService,
    private readonly providers:ProviderService,private readonly now=()=>Date.now()){}

  async exportBytes(input:AgentExportSelection):Promise<Buffer>{
    const select=agentExportSelectionSchema.parse(input);
    if(select.includeKeys){if(typeof select.confirmation!=='string')throw new AgentTransferError('请再次输入导出口令');const issue=passphraseIssue(select.password??'',select.confirmation);if(issue)throw new AgentTransferError(issue);}
    const configs=this.agents.configs(), providerIds=new Set(select.providerIds), selected=configs.filter(c=>select.agentIds.includes(c.id));
    if(selected.length!==new Set(select.agentIds).size)throw new AgentTransferError('选中的智能体已删除');
    if(selected.some(c=>c.source==='login'))throw new AgentTransferError('订阅/API 智能体跟随本机登录，不能导出');
    for(const config of selected)if(config.providerId)providerIds.add(config.providerId);
    const ps=this.agents.providers().filter(p=>providerIds.has(p.id));
    if(ps.length!==providerIds.size)throw new AgentTransferError('选中的供应商已删除');
    if(!ps.length&&!selected.length)throw new AgentTransferError('请至少选择一项');
    const credentials:PortableAgents['credentials']={};
    const agents:PortableAgents['agents']=selected.map(c=>{
      if(c.kind!=='claude'&&c.kind!=='codex')throw new AgentTransferError('此高级配置的 Code Agent 尚不支持导出');
      if(c.source==='provider')return {ref:c.id,name:c.name,source:'provider',kind:c.kind,provider:c.providerId!,models:c.models,defaultModel:c.defaultModel!,homeVisible:c.homeVisible};
      const row=this.db.select().from(aiProfiles).where(eq(aiProfiles.id,c.id)).get()!;
      const env=JSON.parse(row.env) as Extract<PortableAgents['agents'][number],{source:'legacy'}>['env'];
      if(select.includeKeys){const values:Record<string,string>={};for(const e of env)if(e.secret){const value=this.secrets.get(`ai:${c.id}:env:${e.name}`);if(value!==null)values[e.name]=value;}
        if(Object.keys(values).length)credentials[c.id]={env:values};}
      return {ref:c.id,name:c.name,source:'legacy',kind:c.kind,env,args:JSON.parse(row.args),homeVisible:c.homeVisible};
    });
    if(select.includeKeys)for(const p of ps){const row=this.db.select().from(aiProviders).where(eq(aiProviders.id,p.id)).get()!;
      const key=row.secretRef?this.secrets.get(row.secretRef):null;if(key)credentials[p.id]={key};}
    const payload=validate({format:'willyou.agents',version:1,exportedAt:new Date(this.now()).toISOString(),
      providers:ps.map(p=>({ref:p.id,name:p.name,preset:p.preset,endpoints:p.endpoints,authType:p.authType,
        models:p.models.map(({checks:_checks,availability:_availability,...m})=>({...m,availability:{claude:'untested',codex:'untested'}})),recommended:p.recommended})),agents,credentials},select.includeKeys);
    if(select.includeKeys)return encryptTransfer(payload,select.password!,'willyou.agents');
    const bytes=Buffer.from(JSON.stringify(payload,null,2));if(bytes.length>TRANSFER_LIMITS.payload)throw new AgentTransferError('配置内容超过大小限制');return bytes;
  }
  async exportTo(path:string,input:AgentExportSelection,assertCurrent=()=>{}){
    const bytes=await this.exportBytes(input);try{assertCurrent();atomicWrite(path,bytes);return {path};}finally{bytes.fill(0);}
  }
  choose(owner:number,path:string){return this.inspect(owner,readLimited(path));}
  inspect(owner:number,raw:Uint8Array):{token:string;encrypted:boolean;preview:AgentImportPreview|null}{
    this.prune();this.disposeOwner(owner);
    if(raw.byteLength>TRANSFER_LIMITS.file)throw new AgentTransferError('配置文件超过大小限制');
    const value=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    const encrypted=Boolean(value&&typeof value==='object'&&'ciphertext'in value);
    // Authentication parameters are checked before retaining encrypted bytes.
    if(encrypted)inspectEnvelope(raw,'willyou.agents');
    const token=randomUUID(), p:Pending={owner,expires:this.now()+TRANSFER_LIMITS.ttl,raw:Buffer.from(raw)};
    if(!encrypted)p.payload=validate(value,false);
    this.pending.set(token,p);
    if(p.payload)p.preview=this.makePreview(token,p.payload,false);
    return {token,encrypted,preview:p.preview??null};
  }
  async unlock(owner:number,token:string,password:string):Promise<AgentImportPreview>{
    const p=this.require(owner,token),generation=this.generations.get(owner)??0;
    const payload=validate(await decryptTransfer(p.raw,password,'willyou.agents'),true);
    if(this.pending.get(token)!==p||(this.generations.get(owner)??0)!==generation)throw new AgentTransferError('导入预览已取消');
    this.require(owner,token);p.payload=payload;p.preview=this.makePreview(token,payload,true);return p.preview;
  }
  commit(owner:number,token:string):AgentImportResult{
    const p=this.require(owner,token);if(p.result)return p.result;
    if(!p.payload||!p.preview)throw new AgentTransferError('请先输入口令并核对导入预览');
    const payload=p.payload,preview=p.preview;
    const fresh=this.makePreview(token,payload,preview.encrypted);
    if(JSON.stringify(fresh)!==JSON.stringify(preview))throw new AgentTransferError('本机配置已变化，请重新预览');
    const result=this.db.transaction(()=>{
      const providerIds:string[]=[],agentIds:string[]=[],mapping=new Map<string,string>();
      for(const item of payload.providers){const {ref,...provider}=item;
        const saved=this.providers.save({...provider,name:preview.providers.find(p=>p.ref===ref)!.finalName,key:payload.credentials[ref]?.key});
        providerIds.push(saved.id);mapping.set(ref,saved.id);
      }
      for(const item of payload.agents){
        if(item.source==='login')continue;
        const tool=this.agents.tools().find(t=>t.kind===item.kind&&t.installed)??this.agents.tools().find(t=>t.kind===item.kind);
        const toolId=tool?.id??`imported-${item.kind}`;
        if(!tool)this.db.insert(aiTools).values({id:toolId,kind:item.kind,executable:item.kind,installed:false,login:'none',createdAt:this.now(),updatedAt:this.now()}).onConflictDoNothing().run();
        const id=randomUUID(),name=preview.agents.find(a=>a.ref===item.ref)!.finalName;
        this.db.insert(aiProfiles).values({id,name,runner:item.kind,executable:null,env:JSON.stringify(item.source==='legacy'?item.env:[]),
          args:JSON.stringify(item.source==='legacy'?item.args:[]),isDefault:false,createdAt:this.now(),updatedAt:this.now()}).run();
        if(item.source==='legacy')for(const [key,value]of Object.entries(payload.credentials[item.ref]?.env??{}))this.secrets.set(`ai:${id}:env:${key}`,value);
        this.db.insert(aiRunConfigs).values({profileId:id,toolId,source:item.source,providerId:item.source==='provider'?mapping.get(item.provider)!:null,
          models:JSON.stringify(item.source==='provider'?item.models:[]),defaultModel:item.source==='provider'?item.defaultModel:null,homeVisible:item.homeVisible,
          nameCustomized:true,loggedOut:false,sortOrder:this.agents.configs().length,legacyReason:item.source==='legacy'?'从高级配置文件导入，保留原环境与参数':null,migrationVersion:1}).run();
        agentIds.push(id);
      }
      this.agents.reconcileDefaults();
      return {providerIds,agentIds,skipped:preview.skipped};
    });
    p.raw.fill(0);p.payload=undefined;p.result=result;return result;
  }
  disposeOwner(owner:number){for(const [token,p]of this.pending)if(p.owner===owner){p.raw.fill(0);this.pending.delete(token);}this.generations.set(owner,(this.generations.get(owner)??0)+1);}
  private prune(){for(const [token,p]of this.pending)if(p.expires<this.now()){p.raw.fill(0);this.pending.delete(token);}}
  private require(owner:number,token:string){this.prune();const p=this.pending.get(token);if(!p||p.owner!==owner)throw new AgentTransferError('导入预览已失效，请重新选择文件');return p;}
  private makePreview(token:string,p:PortableAgents,encrypted:boolean):AgentImportPreview{
    const names=new Set(this.agents.configs().map(x=>x.name)),providerNames=new Set(this.agents.providers().map(x=>x.name));
    return {token,encrypted,providers:p.providers.map(item=>({ref:item.ref,name:item.name,finalName:importedName(item.name,providerNames,100),
      needsKey:!p.credentials[item.ref]?.key&&!publicLocalMagpie(item.preset,item.endpoints),endpoints:item.endpoints})),
      agents:p.agents.flatMap(item=>item.source==='login'?[]:[{ref:item.ref,name:item.name,finalName:importedName(item.name,names,60),kind:item.kind,source:item.source,
        toolInstalled:this.agents.tools().some(t=>t.kind===item.kind&&t.installed)}]),
      skipped:p.agents.filter(a=>a.source==='login').map(a=>({name:a.name,reason:'订阅/API 智能体跟随本机 CLI 登录，请在本机登录后自行创建'}))};
  }
}
