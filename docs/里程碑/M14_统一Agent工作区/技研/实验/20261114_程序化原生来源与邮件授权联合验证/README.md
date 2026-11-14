# 程序化原生来源与邮件授权联合验证

日期：2026-11-14。D04／D05、Q17／Q41。承接 §4.54 的来源候选和 §4.106 的实际运行／邮件桥，本轮在同一活跃 run 上取得真正的原生接收通知并核验落盘记录，再通过现有邮件授权和执行服务。attempt-19IQI2 五项通过；未改产品源码。

## 基线与研究接线

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，实际 bundle 681 项输入、候选 685 项输入。三份既有 session／run／plan 变体与三份新增来源研究变体由当前源码生成。NativeUserMessages 只增加原生身份穿透，保留原路径、文件／inode／header／原始记录摘要及当前 owner 复核。ApplicationService 的临时构造注入缝接入来源账和固定版本证据解析；MailUserAuthorizations 的旧 ptyId 比较改为显式分支比较。它们是独立运行草案，未完成正式 TypeScript 接口／运行时 Schema，不可直接作为产品补丁。

真实 Codex 0.167.1 与默认 v2 私有桥由实际内核 helper 核验归属。输入账保留来源、inputId、binding、generation、run、配置摘要、sequence 和私有 channel；从实际 item/completed 的 userMessage 核对 thread／turn／item／clientId／原文后接收。固定 Codex 落盘记录再以 turn 和内容关联，raw record ID 不冒充 live item ID。当前 owner 的 binding／generation 从实际 run 表读取，原生连接结束后不允许继续生成 live 来源。

UI sender／frame 是受控替身，内部与用户入口由研究宿主显式选择；不是实际 Electron 输入。模型为本机合成服务，SMTP 只进行回环认证；发送 submit 为受控函数，没有真实 DATA 或真实账号。项目发件身份仍通过模拟管理 UI 确认，但本轮没有调用邮件发送 reviewSend／authorizeSend，发送授权来自实际 tryNative 链。

## 五项检查

| 检查 | 实际结果 |
| --- | --- |
| S01 版本门槛 | 当前默认 adapter 对 0.167.1 的 L3 来源返回 unsupported／AGENT_ADAPTER_UNSUPPORTED。之后才显式打开临时研究声明以验证候选链；不能把实验当作产品已支持该版本 |
| S02 内部输入 | 内部 agent-delegation 的具体发送原文被 Codex 记录为普通 native user 行，MCP send_execute 仍得到 AUTHORIZATION_REQUIRED；没有业务来源行或提交 |
| S03 用户来源 | 同样文字从模拟受信用户入口提交，取得实际原生接受通知；在模型第一个工具请求之前读到并复核精确原生文件证明。现有 tryNative 解析具体草稿修订，生成唯一 native-user-message 来源和授权，受控提交一次；重放返回同 execution 不重复提交 |
| S04 后续失效 | 内部自动接续再次投递同文，旧用户来源仍可保留历史但不再 latest／live，新内部行不变成人类来源；停止 run 后 retained 和 file verify 均失效 |
| S05 身份比较 | 候选比较器拒绝缺失 binding／generation、不同 run／binding／代次、混用 transport 和 undefined ptyId；保留同一有效 PTY 的 terminal／launch-argument 比较。此项为独立函数检查，不宣称已完成多轮上下文授权联合 |

本轮一个真实 Codex、一个真实桥、四个 turn、九次本机模型请求；一个 run stopped、25 份租约 released，两实际进程身份重新核验 stopped，库完整性／外键通过。三次回环认证、一次受控 submit、零 DATA。没有失败重跑原生进程。

## 交叉审计与参考

原生文件有五条 role=user，其中一条是 harness 环境上下文，当前实际证据解析器排除它，余四条分别对应准备、内部发送、用户发送、内部续接。后三条原文相同，各有独立 turn／clientId；唯一持久业务来源只关联第三条的用户 inputId。首次事后审计脚本误把所有 user 角色都算用户输入而断言失败，改用当前实际解析器后核验通过；保留 audit-correction，未重跑原生实验。

只读核对 T3 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`：CodexAdapterV2 的原生 userMessage 可经 emitSubagentUserMessage 映射子 Agent 对话，不能把原生角色等同为真人授权。未运行 T3 或声称它提供 WillYou 的邮件授权合同。

## 设计结论和剩余项

统一 UI 的用户提交须经过实际可信 IPC sender，再由宿主分配完整输入身份；内部委派／历史／自动接续走另一个入口。实时原生回执与磁盘来源匹配可在本固定版本的工具执行前取得，没必要等待整个 turn 完成后才检查，但不能把这一时序推广到 Claude、steer 或其他版本。匹配失败继续走原有明确业务审阅路径，不能猜配、伪造 PTY 或从数据库恢复 live grant。

这里验证了同 run 的实际来源到实际授权，尚未联合真实 UI、输入账崩溃一致性、跨 Provider／委派、原生多消息合并／附件、Claude 最早回执、多轮指代和产品兼容登记。来源仍是 RAM 候选；持久输入恢复证据见原 §4.56，不把两份分别通过的实验当作一个已完成的崩溃恢复链。Q 宽口径状态及正式产品用例不增加完成数。

复现需先运行 patch.py、origin-patch.py、build.mjs 及 build.mjs --candidate，使用归档指定二进制／helper／分发和固定依赖，再执行 probe.mjs、audit.mjs、origin-audit.mjs。setup-probe.py 保存从前批生成本脚本的过程，不在已生成副本上重复执行。所有环境与数据位于独立临时根。见[结果](result.json)、[来源与审计](source-review.json)、[证据归档](raw-evidence.tar.gz)和[摘要](archive-manifest.json)。
