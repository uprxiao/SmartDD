from pathlib import Path
p=Path('src/main/core/applications/connection-service.ts');s=p.read_text().replace("import { randomUUID } from 'node:crypto';","import { randomUUID } from 'node:crypto';\nimport {builtinConfigViews,ConfigViewRegistry} from './config-view-registry';",1)
s=s.replace('definitions?:HostApplicationDefinitions<C,A>){','definitions?:HostApplicationDefinitions<C,A>,private readonly configViews:ConfigViewRegistry=builtinConfigViews){',1)
s=s.replace('const impacts: ConnectionCompatibilityImpact[] = [];','const impacts: ConnectionCompatibilityImpact[] = [],conversions:{packageHash:string;taskId:string|null;converterHash:string;viewDigest:string}[]=[];',1)
a=s.index('        const authMode=this.registry.authMode(config);');z=s.index('\n      if (status) impacts.push',a)
s=s[:a]+'''        if(!contract)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','缺少连接配置契约');
        const view=this.configViews.resolve({providerId:config.kind,sourceSchemaVersion:this.registry.provider(config.kind).configApiMajor,targetApiMajor:contract.configApiMajor,identityContractMajor:contract.identityContractMajor},config,contract.authModes);
        conversions.push({packageHash:record.hash,taskId:record.taskId,converterHash:view.converterHash,viewDigest:view.viewDigest});
      } catch(error) { status=error instanceof ApplicationError&&error.code==='CONFIG_INCOMPATIBLE'?'incompatible':'unverified';reason=status==='incompatible'?'此版本不能等价使用候选配置':'历史包契约或配置转换器无法核验'; }
'''+s[z:]
s=s.replace('const plan = { connectionId:', 'const plan = { conversions,connectionId:',1);p.write_text(s)
