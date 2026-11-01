import type { ConnectionConfig, VerifiedConnectionIdentity } from '@shared/application-connections';
import type { ConnectionVerifier } from '../connection-service';
import { ApplicationError } from '@shared/applications';
import { builtinApplicationModules } from '../modules';
export class ProviderConnectionVerifier implements ConnectionVerifier {
  constructor(private readonly mailWorker: string,private readonly foxmailNative: string) {}
  async verify(config: ConnectionConfig,secret: string | null,signal: AbortSignal): Promise<VerifiedConnectionIdentity> {
    const provider = builtinApplicationModules.provider(config.kind);
    const identity = await provider.verify(config,secret,signal,{mailWorker:this.mailWorker,foxmailNative:this.foxmailNative});
    if(identity.providerId!==config.kind)throw new ApplicationError('AUTH_FAILED','连接校验器返回了其他来源身份');
    return {...identity,providerId:config.kind};
  }
}
