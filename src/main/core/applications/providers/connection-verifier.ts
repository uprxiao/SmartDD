import type { ConnectionConfig, VerifiedConnectionIdentity } from '@shared/application-connections';
import type { ConnectionVerifier } from '../connection-service';
import { ZentaoClient } from './zentao';
import { verifySmtp } from './smtp';
import { MailWorkerClient } from './mail-worker-client';
export class ProviderConnectionVerifier implements ConnectionVerifier {
  constructor(private readonly mailWorker: string,private readonly foxmailNative: string) {}
  async verify(config: ConnectionConfig,secret: string | null,signal: AbortSignal): Promise<VerifiedConnectionIdentity> {
    if (config.kind === 'smtp') return verifySmtp(config,secret,signal);
    if (config.kind === 'zentao') { const client = new ZentaoClient(config,secret); try { return await client.verify(signal); } finally { client.close(); } }
    const client = new MailWorkerClient(this.mailWorker,this.foxmailNative);
    try { return await client.verify(config,signal); } finally { client.close(); }
  }
}
