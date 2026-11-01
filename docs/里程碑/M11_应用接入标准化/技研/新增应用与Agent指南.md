# 新增应用与 Agent 指南（M11 S12）

## 2026-11-02 C3实现接续

基线：R0.9、C2提交699ab83b之后的C3冻结源。公共Runner身份结构化校验，实际可执行性必须通过启动时RunnerAdapterRegistry；AiProfileService保存前应用其profileSchema，任务通过同一生命周期方法运行。CapabilityDeliveryAdapterRegistry按独立Agent id/runner id登记受信机制，CLI机制必须提供自身effectiveSandbox核验，不落回Codex默认规则；类方法保留实例接收者，AgentAdapterRegistry仍核验固定CJS资源、计划与完整投影；原两内置机制复用，未增加真实Agent。原生格式独立注册，IO/预算/文件身份/输入回执仍在宿主。测试脚本第三Agent采用共享HOME投放机制、自身id/argv/会话格式，真实自有PTY新建/恢复、读取Skill并通过实际MCP调用成功；这不是pi/zcode等真实支持结论。

版本日志自检为主进程方法AgentAdapterRegistry.selfCheck，未暴露RPC/MCP。结果只含判据布尔值、hash与时间，绑定适配hash、CLI版本和平台，记录在既有宿主operation journal；日志格式检查只能补L2，不能证明CLI身份/沙箱或L3。每次失败覆盖此前本机绿，原尝试保留。运行时与自检共用skill-observation-contract，避免兼容判断弱于宿主。NativeUserMessages和诊断继续只从注册表读取等级；已发布L3事实不由自检创造。

S11未知版本MCP best-effort已由受信交付机制显式选择：注册表versionSupport统一判定；未知版本只能投放Skill/MCP，不给CLI token/沙箱、L2/L3或原话发送授权。有fallback实际MCP读取、无fallback明确unavailable、已固定会话恢复保留原绑定均在独立I夹具中通过。接续：受影响完整回归已形成有效证据，统一最终包已完成已知CLI和受控未知MCP主链；对应整例及剩余A/R以权威账归账，不将本节写成阶段交付。源码与红绿证据见本阶段最新执行记录与轮次。

更新：2026-11-02。依据：[架构设计](架构设计.md) §4.2、§15.4–15.6，需求 R0.9（M11-R12、R15）。本文只写当前代码里的实际位置；设计里尚未落地的部分单列在“当前缺口”，不当作已经可用。

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

## 二、新增一个 Agent（523f9d85 实现基线）

`Runner` 和资源 `agentId` 使用结构化字符串身份；只有启动时受信注册的实现可以执行。放宽身份字段不等于支持任何新 Agent，也不自动在产品下拉框增加入口。数据库现有文本列不改写。

| 实现位置 | 必须实现／登记的内容 |
| --- | --- |
| `src/main/core/tasks/runner-adapters.ts` 的 `RunnerAdapterRegistry` | A 组：`describe`、`profileSchema`、`discoverExecutable`、`detectVersion`、状态根、`launchArgs`、会话观察／定位及无历史判定；`sessionIdStrategy` 区分宿主指定与原生观察。生产组成根登记实现；测试注入私有 registry。 |
| `src/main/core/applications/capability-delivery-adapters.ts` 的 `CapabilityDeliveryAdapterRegistry` | B 组受信机制：独立 Agent／runner 身份、`inspectNative`、`skillProjection`、`entryDelivery`；声明 CLI 时必须提供该 Agent 自身的 `effectiveSandbox`，不能借用 Codex 默认探针。当前可复用 `shared-home` 和 `session-plugin` 投放机制。类实现保留 `this`。 |
| `resources/agent-adapters/<agentId>/<version>/` | 不可原地替换的固定 CJS 资源（`adapter.json`、`index.cjs`、`planner.cjs`），声明版本／等级、生成无秘密的计划及入口配置。计划、投影、资源哈希和原子发布仍由 `AgentAdapterRegistry` 与宿主核验。 |
| `src/main/core/applications/native-evidence-adapters.ts` 的 `NativeEvidenceAdapterRegistry` | 可选原生格式：定位、头部、用户消息、Skill 发现／读取解析。仅处理宿主交付的有界记录；IO、路径／链接／inode复核、预算、PTY输入回执、授权和清理由宿主管理。未知身份不借用 Codex 解析器。 |

等级规则：

- 必须含 `L0.skill`、`L1`，以及 `L0.mcp`、`L0.cli` 至少一个；`L3` 依赖 `L2`，每个声明等级附版本对应的夹具及负例。
- 本阶段真实 Agent 仅 Codex 0.166.0；L2 已声明并经真实 App 读取核验，L3 仍关闭。Claude 迁入接口但沿用原证据与免真实验证边界，不扩大等级。
- 只有显式支持 `bestEffortMcp` 的交付机制才允许未知版本的 Skill／MCP 尝试；注册表 `versionSupport`／`effective` 是唯一等级读取点。未知 Codex 不发 CLI token、不放宽沙箱、L2／L3关闭；有降级入口只读走 MCP，无降级入口本次不可用且说明原因，发送退回页面授权。
- 主进程 `AgentAdapterRegistry.selfCheck(hash, cliVersion, fixtures)` 是开发／验收自检入口，未暴露 RPC／MCP。它只校验原生日志，最多补 L2，不能凭日志证明 CLI 沙箱／身份，也不能提升 L3。结果绑定资源hash、CLI版本、平台和解析版本，保存在既有 operation journal；新失败覆盖此前本机绿，历史尝试保留。用户原话解析成功也不等于授权。
- 已发布资源不可原地替换；会话保留创建版本与固定包，恢复时探测本次安装版本，并按该版本重新判级，不能跨 Agent 读取。

步骤：

1. 在受信实现中完成 A、B 组并登记；AI配置保存前应用其 `profileSchema`。不修改任务、业务、网关与诊断框架来识别新名字。
2. 发布固定 CJS 资源，先只声明已证明的 L0＋L1；按生效入口渲染同源应用 SOP，不为模型复制业务规则。
3. 跑 `runner-adapters.test.ts`、`capability-delivery-adapters.test.ts`、`agent-consistency.test.ts`、`agent-adapters.test.ts` 的相应合同；以 `task-capability-launcher.test.ts` 内独立身份 `scripted-test` 场景复核真实自有PTY新建／停止／恢复、Skill读取、实际 MCP 业务及固定快照。
4. 需要 L2／L3 时增加原生格式实现与脱敏真实版本夹具，跑 `native-user-messages.test.ts` 和一致性负例（角色伪装、畸形、截断、替换／链接、预算、混合／未知记录等）。自检另跑 `agent-format-self-check.test.ts`，不能用自检代替发布的 L3 证据。
5. 验收使用统一打包 App 和隔离数据，按对应 M 用例全部判据归账；测试脚本 Agent 不代表 pi、zcode 或其他真实 Agent 已适配。

## 三、当前验收边界（2026-11-02）

| 项 | 实际状态 |
| --- | --- |
| 公共身份、生命周期与交付抽象 | 已实现；第三 Agent 真实脚本链及受影响回归通过。新增真实产品入口仍须独立需求／适配验证。 |
| 版本自检 | 已接入宿主注册表及持久化等级读取；严格观察合同、损坏／矛盾回执及失败覆盖均已复验。只有日志证据，不能证明 CLI 或提升 L3。 |
| Codex 0.166.0 的 L2／L3 | L2声明及最终包真实读取通过；L3关闭，页面授权保留。 |
| 诊断 | 统一包 `e19be13c…` 的已知CLI与受控未知版本MCP在浅／深色显示一致；T13全页面、长文本等其余判据尚待完整验收。 |
| 应用扩展静态检查 | `sample-kv.test.ts` 核对通用host/page无样本名分支；T34真实页面选用与Agent等完整判据仍待，不把静态检查单算通过。 |
| 整例与交付 | 以[权威用例账](../验收/测试用例.md)为准；本文描述实现位置，不替代阶段交付结论。Story待用户数据，Windows／Linux不在本阶段范围。 |
