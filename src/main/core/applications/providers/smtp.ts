import { createConnection, isIP, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { z } from 'zod';
import nodemailer, { type NodemailerError, type SMTPTransportOptions } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { ConnectionConfig, VerifiedConnectionIdentity } from '@shared/application-connections';
import { ApplicationError } from '@shared/applications';
import { canonicalJson, digest } from '../manifest';

type SmtpConfig = Extract<ConnectionConfig, { kind: 'smtp' }>;
const header = z.string().max(2000).refine(s => !/[\r\n\x00]/.test(s));
const address = z.email().max(512);
const messageSchema = z.object({
  to: z.array(address).max(100), cc: z.array(address).max(100), bcc: z.array(address).max(100),
  subject: header, text: z.string().max(4 * 1024 * 1024), html: z.string().max(4 * 1024 * 1024).optional(),
  messageId: header.regex(/^<[^<>\s@]+@[^<>\s@]+>$/), date: z.iso.datetime(), inReplyTo: header.optional(), references: z.array(header).max(100).optional(),
}).strict();
export interface FrozenMailInput extends z.infer<typeof messageSchema> { attachments: { filename: string; contentType: string; content: Buffer }[] }
export interface PreparedSmtpMessage { raw: Buffer; rawHash: string; contentHash: string; envelope: { from: string; to: string[] }; messageId: string }
export interface SmtpSubmissionResult { state: 'server-accepted' | 'failed' | 'unknown'; complete: boolean; accepted: string[]; rejected: string[]; errorCode: string | null; smtpCode: number | null; messageId: string }

/** Serialize once, then persist these exact bytes with the execution intent before any SMTP action. */
export async function prepareSmtpMessage(config: SmtpConfig, input: FrozenMailInput): Promise<PreparedSmtpMessage> {
  const { attachments, ...fields } = input;
  const parsed = messageSchema.safeParse(fields);
  if (!parsed.success || !address.safeParse(config.fromAddress).success || attachments.length > 100 || attachments.some(a => !Buffer.isBuffer(a.content) || a.filename.length > 1024 || a.contentType.length > 256 || /[\r\n\x00]/.test(a.filename + a.contentType))) throw new ApplicationError('INVALID_INPUT', '邮件目标、内容或附件字段无效');
  const recipients = [...new Set([...fields.to, ...fields.cc, ...fields.bcc])];
  if (!recipients.length || recipients.length > 100 || attachments.reduce((n, a) => n + a.content.length, 0) > 25 * 1024 * 1024) throw new ApplicationError('INVALID_INPUT', '邮件缺少收件人或超过本次发送预算');
  const compiled = new MailComposer({ ...fields, date: new Date(fields.date), from: config.fromAddress,
    attachments: attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
    disableFileAccess: true, disableUrlAccess: true, newline: 'win' }).compile();
  const raw = await compiled.build();
  if (raw.length > 40 * 1024 * 1024) throw new ApplicationError('INVALID_INPUT', '编码后邮件超过本次预算');
  const envelope = { from: config.fromAddress, to: recipients }, rawHash = digest(raw);
  return { raw, rawHash, contentHash: digest(canonicalJson({ rawHash, envelope, messageId: fields.messageId })), envelope, messageId: fields.messageId };
}

async function withSmtp<T>(config: SmtpConfig, secret: string, signal: AbortSignal, action: (transport: ReturnType<typeof nodemailer.createTransport>) => Promise<T>): Promise<T> {
  if (signal.aborted) throw new ApplicationError('CANCELED', '发件操作已取消');
  const sockets = new Set<Socket>(); let abortReject: ((error: ApplicationError) => void) | undefined;
  const abort = () => {
    const error = signal.reason instanceof ApplicationError ? signal.reason : new ApplicationError('CANCELED', '发件操作已取消');
    for (const socket of sockets) socket.destroy(error);
    abortReject?.(error);
  };
  const getSocket: NonNullable<SMTPTransportOptions['getSocket']> = (_options, callback) => {
    if (signal.aborted) { callback(new ApplicationError('CANCELED', '发件操作已取消')); return; }
    let handed = false;
    const secure = config.mode === 'implicit-tls';
    const socket = secure ? tlsConnect({ host: config.host, port: config.port, servername: isIP(config.host) ? undefined : config.host, rejectUnauthorized: true }) : createConnection({ host: config.host, port: config.port });
    sockets.add(socket);
    socket.once(secure ? 'secureConnect' : 'connect', () => { if (!handed) { handed = true; callback(null, { connection: socket, secured: secure }); } });
    socket.once('error', error => { if (!handed) { handed = true; callback(error); } });
    socket.once('close', () => sockets.delete(socket));
  };
  const options: SMTPTransportOptions = { host: config.host, port: config.port, secure: config.mode === 'implicit-tls',
    ignoreTLS: config.mode === 'plain', requireTLS: config.mode === 'starttls', opportunisticTLS: false,
    auth: { user: config.username, pass: secret }, forceAuth: true, pool: false, logger: false, debug: false, transactionLog: false,
    tls: { rejectUnauthorized: true }, name: 'willyou.local', connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000,
    disableFileAccess: true, disableUrlAccess: true, getSocket };
  const transport = nodemailer.createTransport(options);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { const error = new ApplicationError('TIMEOUT', 'SMTP操作超时'); for (const socket of sockets) socket.destroy(error); abortReject?.(error); }, 8000);
  try {
    return await Promise.race([action(transport), new Promise<never>((_, reject) => { abortReject = reject; if (signal.aborted) abort(); })]);
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort); for (const socket of sockets) socket.destroy(); transport.close();
  }
}
export async function verifySmtp(config: SmtpConfig, secret: string | null, signal: AbortSignal): Promise<VerifiedConnectionIdentity> {
  if (!secret) throw new ApplicationError('AUTH_REQUIRED', '请配置SMTP认证凭据');
  try {
    await withSmtp(config, secret, signal, transport => transport.verify());
    return { providerId: 'smtp', serviceId: 'smtp://' + config.host.toLowerCase() + ':' + config.port, accountId: config.username, contractMajor: 1 };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    const code = (error as NodemailerError).code;
    throw new ApplicationError(code === 'EAUTH' || code === 'ENOAUTH' ? 'AUTH_FAILED' : code === 'ETIMEDOUT' ? 'TIMEOUT' : 'CONNECTION_UNAVAILABLE', code === 'EAUTH' ? '发件账号认证失败' : '无法验证发件连接或TLS证书');
  }
}
/** One attempt. The durable execution service must never retry this submission automatically. */
export async function submitSmtp(config: SmtpConfig, secret: string, prepared: PreparedSmtpMessage, signal: AbortSignal): Promise<SmtpSubmissionResult> {
  const base = { complete: false, accepted: [] as string[], rejected: [] as string[], errorCode: null as string | null, smtpCode: null as number | null, messageId: prepared.messageId };
  if (signal.aborted) return { ...base, state: 'failed', errorCode: 'CANCELED' };
  if (digest(prepared.raw) !== prepared.rawHash || digest(canonicalJson({ rawHash: prepared.rawHash, envelope: prepared.envelope, messageId: prepared.messageId })) !== prepared.contentHash || prepared.envelope.from !== config.fromAddress) return { ...base, state: 'failed', errorCode: 'CONTENT_CHANGED' };
  try {
    const info = await withSmtp(config, secret, signal, transport => transport.sendMail({ raw: prepared.raw, envelope: prepared.envelope, disableFileAccess: true, disableUrlAccess: true }));
    const accepted: string[] = Array.isArray(info.accepted) ? info.accepted.map(String) : [], rejected: string[] = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
    const expected = new Set(prepared.envelope.to);
    if ([...accepted, ...rejected].some(address => !expected.has(address))) return { ...base, state: 'unknown', errorCode: 'RECEIPT_MISMATCH' };
    return { ...base, state: accepted.length ? 'server-accepted' : 'failed', accepted, rejected, complete: rejected.length === 0 && accepted.length === prepared.envelope.to.length,
      smtpCode: /^\d{3}/.test(info.response ?? '') ? Number(String(info.response).slice(0, 3)) : null };
  } catch (error) {
    if (error instanceof ApplicationError) return { ...base, state: 'unknown', errorCode: error.code };
    const detail = error as NodemailerError, responseCode = detail.responseCode ?? null;
    const definite = ['EAUTH', 'ENOAUTH', 'EENVELOPE', 'ECONFIG', 'EMAXRECIPIENTS', 'EFILEACCESS', 'EURLACCESS'].includes(detail.code ?? '') || (responseCode !== null && responseCode >= 400 && responseCode <= 599);
    return { ...base, state: definite ? 'failed' : 'unknown', errorCode: detail.code ?? 'SUBMISSION_UNCONFIRMED', smtpCode: responseCode };
  }
}
