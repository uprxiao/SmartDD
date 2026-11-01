# 新增应用与 Agent 指南（M11 S12）

更新：2026-11-01。依据：[架构设计](架构设计.md) §4.2、§15.4–15.6，需求 R0.9（M11-R12、R15）。本文只写当前代码里的实际位置；设计里尚未落地的部分单列在“当前缺口”，不当作已经可用。

## 一、新增一个应用

以 `sample-kv` 为参考样本（`src/main/core/applications/modules/sample-kv/`、`resources/applications/sample-kv/`）。

**允许改：**

| 位置 | 内容 |
| --- | --- |
| `resources/applications/<appId>/<version>/` | 应用包：manifest v2、契约 schema、Skill 模板 |
| `src/main/core/applications/modules/<appId>/` | 受信模块：`appId`、`contractMajors`、`slots`、`providers[]`、`executors`，可选 `upstream`、`migrations` |
| `src/main/core/applications/modules/index.ts` | `applicationModules` 数组加一行 |
| `src/shared/application-module-catalog.json` | 由构建脚本从注册表生成，不手改 |

**不允许改：** `tool-service.ts`、CLI／MCP 入口与网关、`execution-context.ts` 的通用部分、会话快照与诊断框架、渲染端通用应用页面。需要改这些文件，说明抽象不足，先回到架构设计修订。

**步骤：**

1. 建应用包目录，写 manifest v2 与能力契约 schema；写能力必须声明 `protection`（业务级防重）。
2. 建受信模块，执行器复用 `HostToolOperation` 接口（`semantics`／`retry`／`authorize`／`execute`）。
3. 在 `modules/index.ts` 注册。内置应用的预期集合直接取自注册清单，不需要再改 `agent-support-service.ts`（缺陷 M11-R1-D01 的修复）。
4. 运行 `pnpm test:prepare` 重建能力包，再跑 `pnpm typecheck` 与受影响测试。
5. 连接表单由模块配置视图通用渲染，不写应用专用页面。

## 二、新增一个 Agent

**A 组（运行器生命周期）：** 在 `src/main/core/tasks/runner-adapters.ts` 实现 `RunnerAdapter`：`stateEnvVar`、`sessionIdStrategy`（`host` 或 `observed`）、`sessionFile(root, cwd, sessionId, {sinceMs, scan})`，并加入 `adapters` 表。

**B 组（能力交付与证据）：** 在 `resources/agent-adapters/<agentId>/<version>/` 发布适配资源（`adapter.json`、`index.cjs`、`planner.cjs`）。`adapter.json` 用 `levels` 按 CLI 版本声明等级：

- 必须含 `L0.skill`、`L1`，以及 `L0.mcp`、`L0.cli` 至少一个。
- `L3` 依赖 `L2`；L2、L3 必须随资源附夹具与负例，**本机自检最多提升到 L2**（`raiseBySelfCheck`）。
- 未声明的版本按 `effectiveLevels([])` 降级：只有 `L0.skill`／`L0.mcp`，诊断标“未验证”，不交付 CLI，发送退回页面点击授权。
- 已发布的适配资源不可原地替换，改动须用新版本号。

**步骤：**

1. 实现 A 组，并补 `runner-adapters.test.ts` 的契约断言。
2. 发布 B 组资源，先只声明 L0＋L1。
3. 跑一致性套件 `src/main/core/applications/__tests__/agent-consistency.test.ts`：正例必须产出证据；畸形、截断、超预算、窗口外、角色伪装、调用与输出不匹配、内容被改、未知记录形态都不得产出证据。
4. 需要 L2／L3 时，用真实 CLI 版本的脱敏日志补正例和负例，通过后再在 `levels` 登记。

## 三、当前缺口（2026-11-01）

| 项 | 状态 |
| --- | --- |
| `Runner` 类型 | 仍是 `'claude' \| 'codex'` 联合类型。新增真实 Agent 还要放宽它及 `agentAdapterMetadataSchema.agentId`；假第三 Agent 夹具只验证了接口形状（T35 仅软件部分） |
| 其余 runner 分支 | `task-capability-launcher.ts`、`native-user-messages.ts` 等约 20 个文件仍有 claude／codex 分支，尚未全部迁入适配器 |
| Codex 0.166.0 的 L2／L3 | 关闭。脱敏样本缺 Skill 读取正例，需一次真实 Codex 运行补样本 |
| 版本自检 | 只有判定函数 `raiseBySelfCheck`，未接入启动流程与诊断（T26 未完成） |
| 诊断显示“未验证” | 属 S8，未实施 |
| CI 检查“不允许改的文件无应用名分支” | 未实施（T34 判据之一） |
