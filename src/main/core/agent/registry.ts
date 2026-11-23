// 执行器注册表：不可变注册项，新增执行器只登记 Driver，不改任务／编排层（技术方案 T1.5 §3、R12）。
import type { DriverId } from './capabilities';
import type { AgentDriver } from './driver';
import { claudeSdkDriver } from './drivers/claude-sdk';
import { codexAppServerDriver } from './drivers/codex-app-server';
import { antigravityAcpDriver } from './drivers/antigravity-acp';

export const DRIVERS: ReadonlyMap<DriverId, AgentDriver> = new Map<DriverId, AgentDriver>([
  [claudeSdkDriver.id, claudeSdkDriver],
  [codexAppServerDriver.id, codexAppServerDriver],
  [antigravityAcpDriver.id, antigravityAcpDriver],
]);
