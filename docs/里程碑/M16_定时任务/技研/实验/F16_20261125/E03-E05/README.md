# M16 F16 开发前专项实验 E03–E05

日期 2026-11-25，生产基线 `feature/0.1.7`，提交 `a0acddb3a2325c6bf732adaa7e954ce4d767a2c3`。macOS arm64。本资料仅为开发前技术可行性证据，未实现定时任务模块或执行产品验收。

## 实际执行

冻结 `src/main`、`src/shared`、`drizzle`、`resources/standard-skills`、`resources/runtime`、`package.json`、`vitest.config.ts` 自指定 Git 提交。私有测试根 `/private/tmp/willyou-m16-E03E05.DyUBda3d`；只读复用安装好的 `node_modules`，单 Worker Electron bundled Node，未开 App、未启用 GUI，未构建或修改共享生产源码。使用生产迁移、AgentStore、AgentRunService、AgentTaskService、Driver registry、resolveProfileLaunch、materializeAgentPlan。通过生产 `boundedEvent` 及 store.subscribe 验证实际事件流，未启动完整主进程 `createAgentWorkspace`、IPC 或 renderer。CLI 真实路径固定为本次本机发现路径，运行前 `--version` 并动态解析版本能力，不以某个版本号作为唯一验收条件；前后 SHA256 核对一致。PID 来自真实进程事件，使用已有原生只读身份核验 helper 的私有副本 `0ed9ce5b156953bb75d56bce3a66508076baa297c8ea898a3e6fdd9cbed3b67b` 核对结束。

CLI 启动环境白名单、独立 HOME/userData、每场独立 cwd/SQLite/临时端口；全部模型地址及代理指向实际本机合成协议服务。代理拒绝绝对 URL 代理请求和 CONNECT；实际三场拒绝记录空。未读用户的实际凭据、未调用真实外部模型和用户站点，未启用任何真实业务工具；所有输入为合成文字，初始 ask。本地协议记录只保存模型名、推理强度、合成标记及请求时间，不保存完整请求头、正文或认证值。运行时目录不入归档。代理记录不能作为 OS 级网络审计证据。

实际命令（在权限环境中需要允许本机回环监听）

```sh
/private/tmp/willyou-m16-E03E05.DyUBda3d/run.sh codex
/private/tmp/willyou-m16-E03E05.DyUBda3d/run.sh claude,antigravity
/private/tmp/willyou-m16-E03E05.DyUBda3d/run.sh binding
node /private/tmp/willyou-m16-E03E05.DyUBda3d/evidence/verify-results.mjs
```

首次运行未提取真实 Skill/runtime 资源导致初始化失败（`run-codex-attempt1.log`），从同提交提取资源后进到测试；第二次沙箱本机监听 EPERM（`run-codex-attempt2.log`），授权本地回环后运行成功（`run-codex-attempt3.log`）。其余执行日志保留。

## E03、E04、E05 对应结果

| 实验 | 实际观察 | 设计结论及限制 |
| --- | --- | --- |
| E03 | 三种驱动均从真实 AgentTaskService.create/submit 和 enqueueHost 接收输入；稳定 task/clientInput ID 去重、错误选择修订拒绝、持久 turn.accepted/started/ended 与订阅事件序列一致，9 个实际回合完成。普通程序化 submit 储存 user，宿主 enqueueHost 储存 system，未产生真人证据。 | 当前 `submit` 固定 source_kind=user、`enqueueHost` 不接受 expectedSelectionRevision 且来源枚举只有 delegation/notification/system。本轮 system 是技术复用探针。F16 应新增独立 schedule 来源和按计划运行 ID 去重的受信输入接口，持久化领取与确认接受保持一致；计划不得借用真人授权。 |
| E04 | 实际本机 Codex 0.171.0（Responses）、Claude Code 2.1.331（Messages）、Antigravity 1.5.14（Gemini ACP）分别完成 3 轮；主模型请求 9 个，AGY 本机辅助模型请求 2 个。初次模型/low，续聊变更至第二模型/high，新任务重新使用第一模型/low；回环请求实际字段核验一致。AGY 模型采用 gemini-4-carbon、gemini-4-argon。 | 三执行器任务发送能复用原生驱动和受支持模型档位；这里是实际 CLI 对确定性协议夹具，不包含真实第三方模型服务、登录流程、能力业务授权、完整系统运行验收。 |
| E05 | 实际关闭第一轮运行后同任务续接，三种驱动 nativeId、bindingId 相同、代次 1→2、真实请求包含首轮回答；同 cwd 新任务新 nativeId/bindingId，真实请求没有首轮标记。持有原生模型请求时服务报告 working，现有 HOST 输入会排队，实验取消见证输入且未发出；归档、失效任务实际拒绝。实际切 Agent 与同 Agent 的不同 Provider 后选择修订变化，旧输入拒绝；权限改变由真实任务接口保存。真实 launch resolver 同 Provider ID 的端点或认证变更影响兼容 identity。两个实际物理目录具有同一 profile/provider 兼容属性但各自物理路径。 | F16 的连续复用/指定已有任务均依赖同一持久绑定；新建任务独立。忙碌/失效处理依赖原子领取新增门槛，不能仅判断状态后调用会排队的现有接口。必须约束 Provider/Agent/目录/权限身份，模型与推理变化允许跟随；实验的比较函数为设计验证，未在产品中实现确认交互、任务迁移或计划调度。 |

三场 CLI 共 9 个终态、9 个主模型本机请求、2 个 AGY 辅助本机请求、9 个原生 PID 核验 stopped；未观察外发代理请求。Binding 补充实验不发送任何模型请求。独立 `verify-results.mjs` 对 4 份结果复验，汇总为 `verified-summary.json`。计数仅为专项实验，不能当作正式验收用例通过数。

## 复跑与证据

`run-v1.sh`、`m16-model-fixture-v1.ts`、`m16-schedule-preflight-v1.test.ts` 为前三场原始可复跑驱动。`m16-schedule-preflight-v2.test.ts` 原样保留前三场逻辑并增加 `binding` 补充实验。把 v2 和 fixture 拷贝到同一私有冻结基线 `src/main/core/agent/` 下，文件名分别为 `m16-schedule-preflight.test.ts`、`m16-model-fixture.ts`，`run.sh` 在私有根运行。实际汇总验证使用明确的原始报告名；新跑报告另作新日期/批次验证，不覆盖历史。`production-inputs.sha256` 含主要冻结源文件的原始绝对路径。共享依赖和已编译身份核验 helper 需在复跑时经本机可用性核对。
