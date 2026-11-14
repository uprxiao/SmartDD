# M13 插件化、能力统一管理与 AI 配置优化

2026-11-15 最新自主补验：T049已正式归档；T100的Claude两档位原生MCP／宿主审批及Claude、Codex双向原SID权限恢复组件已核对归档，见[本批执行记录](验收/执行与缺陷记录.md#2026-11-15-t100-请求批准原生-mcp-宿主审批组件-i)。仅补组件覆盖，原整条状态以[唯一用例账](验收/测试用例.md)为准。继续不需本人凭据的独立矩阵，钥匙串与账号留后；独立项耗尽时按用户安排暂停，不重复打包。

2026-11-14 后续阶段调整（用户确认）：本阶段之后安排 [M14 统一 Agent 工作区](../M14_统一Agent工作区/README.md)，定时任务顺延为 [M15](../M15_定时任务/README.md)。本阶段现有范围、进度及授权保持，以本页权威记录为准。

更新：2026-11-14。来源：[需求池 F28／F29／F31](../../需求池.md)。需求基线：**R1.0（由 R0.3 及补记 1–8 合并，定稿评审稿）**。当前分支：`feature/0.1.4`。状态：**P1 门槛完成；M13其余范围已授权，开发与验收收口中，尚未完成**。2026-11-11 用户明确要求“制定目标，先跑P1”，授权按现行需求 R1.0、技术方案 T1.0、原型 P0.20 与验收基线实施插件 P1 门槛、相关测试及缺陷修复。2026-11-12用户进一步授权完成整个M13开发阶段，按检查点→AI配置完整闭环→Skill／MCP→插件UI→整体回归／交付推进；P1检查点已提交推送，本次不合并main或发布。

当前接续（2026-11-15）：[App059/source013](验收/证据/M13-App059-manual-models-and-Magpie-guard-build-452-20261115-a1/coordinator-verdict.json) 已完成统一构建、审计与六项原生检查；[T049 Magpie 原完整验收](验收/证据/M13-T049-real-Magpie-catalog-task-and-owner-stop-App059-454-20261115-a1/coordinator-verdict.json) 已归账。[手填模型的真实 SMG 接入与逐模型检查](验收/证据/M13-T096-manual-SMG-real-setup-and-confirmed-keychain-gap-App059-459-20261115-a1/coordinator-verdict.json)已归档；会话工具／模型切换留系统安全存储前置，[受控上游失败与错误展示 U](验收/证据/M13-T096-upstream-retry-and-error-UI-U-460-20261115-a1/coordinator-verdict.json)已补齐。后续先核独立权限／浏览器矩阵，用户休息期间先自主完成，需要本人处理的最后执行，确无可自主推进项时按用户要求暂停。正式状态只取[唯一用例账](验收/测试用例.md)，尚未完成 M13。 [T100 完全访问浏览器组件 I](验收/证据/M13-T100-Claude-full-real-browser-risk-and-revoke-I-463-20261115-a1/coordinator-verdict.json)已补，继续独立权限矩阵；未提升整条状态。

最新接续（2026-11-14）：集中收口原部分通过用例。当前统一基线为[source011／App057](验收/证据/M13-App057-WillYou-label-build-audit-smoke-375-20261114-a1/coordinator-verdict.json)（按用户确认统一“WillYou”设置分组，原型P0.24与[四实际视图](验收/证据/M13-T073-approved-WillYou-settings-label-software-App057-fourviews-376-20261114-a1/coordinator-verdict.json)已核；仅locale两字符串变，主进程／preload与App056相同）；[会话插件面板原型纠偏十视图A](验收/证据/M13-T073-App056-approved-compact-ten-view-A-343-20261114-a1/coordinator-verdict.json)已通过，[T075原完整九步U+A](验收/证据/M13-T075-App056-original-nine-step-complete-A-349-20261114-a1/coordinator-verdict.json)已收口并归账。[T073原完整旧功能清单](验收/证据/M13-T073-original-complete-contract-union-root-384-20261114-a1/coordinator-verdict.json)已按17项实际证据联合完成；[T076原完整邮件合同](验收/证据/M13-T076-original-complete-union-final-project-tail-356-20261114-a1/coordinator-verdict.json)已按同案真实Agent前缀、实际发送／未知核对及项目／停启尾段联合完成；原驱动红与后置纠正证据保留，未重发邮件。[T061原四任务I+A](验收/证据/M13-T061-original-cold-four-task-complete-App056-A-363-20261114-a1/coordinator-verdict.json)已完整收口；[T074原完整U+A+S](验收/证据/M13-T074-original-full-UI-OS-native-transfer-App056-371-20261114-a1/coordinator-verdict.json)已收口，真实两实例导入导出／原生选择器／OS Key及补Key启动全部通过；[T082原跨项目引用A+I](验收/证据/M13-T082-original-complete-A-I-union-foreign-live-B-395-20261114-a1/coordinator-verdict.json)已按原A/C运行前置联合完整通过，T064三种非身份变化视图及合法旧宿主回收已补，原来源成功恢复在[确认的OS钥匙串等待](验收/证据/M13-T064-models-control-and-confirmed-OS-keychain-wait-379-20261114-a1/coordinator-verdict.json)处保留，未重复保存；T082原两任务、A插入和外项目仍运行时B预填均已实际补齐，原失败与不足前置子段保留。[原附件保存尾段](验收/证据/M13-T073-original-native-text-binary-attachment-save-App057-381-20261114-a2/coordinator-verdict.json)已一次完成，完整旧清单联合根复核已通过；系统安全操作集中留后。未执行部分保留。正式状态只取[唯一用例账](验收/测试用例.md)，资源与接续见[轮次记录](验收/并行测试/轮次/M13-AI-20261112T151240Z-96e267/轮次记录.json)。自主完成可自动化步骤，密码／本人登录留后，按根[AGENTS.md](../../../AGENTS.md)执行。

最新完整收口：[T080 原完整 I＋A 联合验收](验收/证据/M13-T080-original-complete-I-A-union-420-20261114-a1/coordinator-verdict.json)已正式通过；所有原驱动红、系统等待与诊断边界保留。T064 协议静稳后的[一次下键稳定观测](验收/证据/M13-T064-protocol-quiescence-oneDown-stableYes-diagnostic-419-20261114-a1/coordinator-verdict.json)已通过，下一步只接回原来源切换与恢复业务，不重复 T080 已完成流程。正式状态只取唯一用例账，M13 尚未完成。

最新增量：[421原②来源切换A完整](验收/证据/M13-T064-original-source-change-II-complete-A-421-20261114-a1/coordinator-verdict.json)已补齐原②；当前仅接③④跨目录、缺源与默认同名保护的实际App余项。已通过部分不重播，沿用App057，无生产改动或重新打包。

本轮检查点：`247d9037b` 已提交推送并核远端一致。

阶段检查点：`5a9e04382441e24624cb94635f9d902c543a03d7`及会话插件纠偏提交`83b952aa0570c84aa1a5291e067bb85b5d2092b0`均已推送并核远端一致；后者按原型移除未批准诊断与管理入口，组件／调用方测试、类型检查及上述实际App已验证。生成App／二进制／原始载荷保持忽略，以[本地索引](验收/本地运行产物索引_20261112.json)追溯；当前不装机、不合并main、不打tag、不发布，M13尚未完成。

此前接续依据（保留已形成证据链接，派发以以上最新记录为准）：统一隔离包 App050 的[Claude 完整模型恢复](验收/证据/M13-T064-Claude-full-model-restore-App050-20261114-a1/coordinator-verdict.json)与[Codex 影响回归](验收/证据/M13-T064-Codex-affected-App050-20261114-a1/coordinator-verdict.json)已完成原①；跨目录真实回忆、拒绝和[非空子树复制](验收/证据/M13-T064-nonempty-subtree-copy-I-20261114-a1/coordinator-verdict.json)已各按层归档，[合成默认目录恢复与同名保护 I](验收/证据/M13-T064-defaultroot-restore-and-collision-I-20261114-a1/coordinator-verdict.json)也已补齐，[三种来源变化的真实 Native I](验收/证据/M13-T064-three-source-changes-Native-I-20261114-a1/coordinator-verdict.json)也已补齐，恢复弹框 A 等缺项保留。T080 原生命周期 I 各段已归账，App050 的[停用/启用/MCP三项N1](验收/证据/M13-T080-App050-three-N1-A-and-dialog-driver-red-20261114-a1/coordinator-verdict.json)及[保数据卸载N1](验收/证据/M13-T080-App050-uninstall-N1-A-20261114-a1/coordinator-verdict.json)已补齐，完整生命周期实际 App/原生picker仍缺；T061 冷启动竞争修复已接入源码，[原空 HOME 四任务真实 CLI I](验收/证据/M13-T061-cold-four-task-I-App051-20261114-a1/coordinator-verdict.json)已通过，真实 App／OS 层继续；[只读内核元数据基础接口](验收/证据/M13-T061-production-native-metadata-U-20261114-a1/coordinator-verdict.json)及[只读迁移 reader](验收/证据/M13-T061-production-DDL-reader-U-20261114-a1/coordinator-verdict.json)已接入并通过单测，[统一 direct/remote 启动协调](验收/证据/M13-T061-production-startup-coordination-U-20261114-a1/coordinator-verdict.json)已接源码及相关软件验证，[App051 构建与原生校验](验收/证据/M13-App051-build-audit-and-smoke-20261114-a1/coordinator-verdict.json)已完成，完整打包 App 验收继续。下一自主组补内置邮件／浏览器活会话的即时授权与恢复加载。用户最新安排为外出期间先自主执行，钥匙串、本人验证和真实账号人工步骤放最后；既有现场确认仍按原证据保留。正式状态只取[唯一用例账](验收/测试用例.md)，M13 尚未完成，当前不装机、不合并 main、不发布。

现场系统补验已归账：[T022／T023 图标观察](验收/证据/M13-T022-T023-live-system-visual-20261114-a1/coordinator-verdict.json)、[T065 复制与外部打开](验收/证据/M13-T065-real-copy-external-open-S-20261114-a1/coordinator-verdict.json)、[T042 两端真实键盘拒绝](验收/证据/M13-T042-dual-CLI-physical-refusal-S-20261114-a1/coordinator-verdict.json)、[T063 Claude 写入拒绝](验收/证据/M13-T063-real-system-keyboard-refusal-S-20261114-a1/coordinator-verdict.json)已补齐各自原合同，内部驱动红与观察边界保留。当前接续 T075 完整连接顺序实际 App，随后 T064 来源变化实际 App；正式状态仅取唯一用例账。

最新完整收口：[T016 内置插件即时拒绝与恢复加载](验收/证据/M13-T016-builtin-live-and-resume-complete-A-20261114-a1/coordinator-verdict.json)已补齐原 A 合同；此前目录／详情结果沿用，实际同任务四阶段与源码适用性均已复核。继续 T075 完整连接顺序、T064 来源变化与其余原用例，正式数量只取唯一用例账。

当前增量：[T024 原生选择器完整 S](验收/证据/M13-T024-original-native-three-picker-complete-S-20261114-a1/coordinator-verdict.json)与[T029 Skill 来源生命周期完整 I／A／R](验收/证据/M13-T029-full-lifecycle-real-App-A-R-20261114-a1/coordinator-verdict.json)已归账；原驱动、隔离载体缺组件等失败仍保留。T025 的[目录真实键盘原S](验收/证据/M13-T025-catalog-physical-keyboard-partial-and-driver-red-S-20261114-a1/coordinator-verdict.json)已补齐有效部分，驱动的图标前缀误判保留；剩余三区域的新实例在首个系统前台查询无对象时零按键停止，原生层留后，不要求用户现在操作。T061 实际 App 已进入原 OS 保存，在钥匙串读取门处保留现场并有界收尾，人工安全验证留后。[项目插件页拒绝提示修正](验收/证据/M13-T073-project-plugin-guidance-copy-U-20261114-a1/coordinator-verdict.json)已过软件定向检查，并纳入[统一 App052](验收/证据/M13-App052-build-audit-and-smoke-20261114-a1/coordinator-verdict.json)；实际拒绝提示补验仍待。项目迁移与运行能力的其余用词已同步原型 P0.23 并进入[统一 App053](验收/证据/M13-App053-build-audit-and-smoke-20261114-a1/coordinator-verdict.json)，软件／构建已验证，新增实际 A 继续。[T030 第三方 Claude 用户 Skill 的真实 I](验收/证据/M13-T030-Claude-provider-user-Skill-Native-I-20261114-a1/coordinator-verdict.json)已补齐，实际 App／订阅分支仍留缺项。当前自主批次不请求用户操作，需要本人安全验证的缺项留后；正式状态只取唯一用例账。

标准 Skill 在 Claude 独立配置根的接线已修复，相关软件回归及 App024 构建已通过；官方 CLI 实际加载与插件刷新打包验收继续，详见[本批记录](验收/执行与缺陷记录.md#2026-11-13-标准-skill-独立-claude-根及插件刷新补齐)。

启动源码基线：`e851900f9`，开始时工作区干净。[P1 执行计划](验收/P1执行计划.md)列出范围、逐项判据和接续位置；[执行与缺陷记录](验收/执行与缺陷记录.md)记录实际实现与验证。此前[复核 2142](../../review/review-20261111-2142.md)无新增问题，评审历史保留。

M13 包含插件化重构、CLI 安装后的能力发现与统一管理、AI 配置优化及相应 UI；具体规则和本期边界统一见[需求](需求.md)。M15 定时任务留后续，M 编号与分支／发布版本分别维护。

| 资料 | 当前状态 |
| --- | --- |
| [需求 R1.0](需求.md) | 由 R0.3 与补记 1–8 合并的现行正文，被替换写法见修订记录与附录；[R0.3 合并前全文](历史/需求_R0.3_20261111.md)已归档 |
| [插件机制与范围初步调研](调研/插件机制与范围讨论_20261110.md)、[AI 配置与 Magpie 源码核对](调研/CodeAgent与Provider现状核对_20261110.md)、[参考截图](调研/参考截图/来源与哈希.json) | 只读调研，按形成时点保留；截图为参考，非已确认原型 |
| [Codex 配置载体与模型恢复实验](技研/T-CFG_T-MODEL_Codex实验_20261110.md) | 已完成 |
| [Claude Code 配置载体与模型恢复实验](技研/T-CFG_T-MODEL_ClaudeCode实验_20261110.md) | 已完成（不含用户排除的订阅登录）；负例与恢复规则由补验 A3 补齐 |
| [MCP 跨 Agent 转换实验](技研/MCP跨Agent转换实验_20261110.md) | 基本通路已完成；转换规则已由补验 A1 修订 |
| [插件包协议与隔离实验](技研/插件包协议与隔离实验_20261110.md) | 独立实验已完成；完整禅道声明由补验 A5 补齐；宿主端到端与 Electron 密钥隔离为正式开发 P1 门槛 |
| [技研审核报告](../../review/review-20261110-1549.md) | 2026-11-10 审核：方向可行，需 A1–A5 定向补验，不整批重跑 |
| [补验 A1 MCP 语义与策略](技研/补验A1_MCP语义与策略_20261110.md) | 已完成：转换规则修订后双向语义一致；凭据过滤、审批（默认询问／允许／禁用、TUI 拒绝零执行）通过；Claude 权限模式待技术方案定案 |
| [补验 A3 AI 隔离与恢复](技研/补验A3_AI隔离与恢复_20261110.md) | 已完成：缺／失效 Key 不回退且无外连；发现 `CLAUDE_CODE_OAUTH_TOKEN` 与配置目录残留认证会被使用，需补清除与校验规则；并发、恢复模型（`requestedModel`）、全局还原、旧配置分类均通过（全局还原为实验结果，自动写回方案已按第四轮审核排除） |
| [补验 A2 Skill 生命周期](技研/补验A2_Skill生命周期_20261110.md) | 已完成：符号链接单向跟随在两侧均可加载、调用、执行相对脚本、随来源更新、删除后安全忽略；Codex 无按次注入且同名并列，需全根冲突检查；Claude 原有登录用 `--plugin-dir` 不写用户目录 |
| [补验 A4 Provider 接入](技研/补验A4_Provider接入_20261110.md) | 已完成：DeepSeek 官方直连 Codex／Claude 工具调用通过；`/models` 元数据与免费协议探测可支撑一键接入；失败回退明确；发现 Codex 第三方运行仍外连 chatgpt.com，需 `--disable plugins`＋关闭统计 |
| [补验 A5 插件声明与设计](技研/补验A5_插件声明与设计_20261110.md) | 已完成：完整禅道声明经语义校验与渲染模型证明可覆盖原面板全部要素；生命周期、迁移与 P1 硬门槛已定义 |
| [第二轮技研审核](../../review/review-20261110-1638.md) | 2026-11-10：A1–A5 多数有效，但新增 5 个反例与证据缺口，R01／R02／R04–R07／R09／R11 仅部分关闭（以审核报告为准） |
| [补验 B 审核二修正](技研/补验B_审核二修正_20261110.md) | 已完成：F01／F02 隔离修正、F03–F05 修正、F06 按用户决定（带凭据 URL 不支持转换）、F07 三项证据均有旧红／新绿；F08／F09 并入设计。新增“第三方运行不应用项目／本地 Claude 设置”，用户已确认（权限规则与钩子不生效可接受） |
| [第三轮技研审核](../../review/review-20261110-1744.md) | 2026-11-10：上一轮五个反例已修复、证据补齐；新增 G01 参数冒充控制标记（高）及 G02／G03 需求口径 |
| [补验 C 审核三修正](技研/补验C_审核三修正_20261110.md) | 已完成：G01 包装 v3 控制／数据分离，旧红复现、12 项新绿；G02 改为原子挪走＋仅不存在时创建，6 个并发注入点均不丢失外部写入（实验结果，写回方案已按第四轮审核排除，见该记录末尾更正）；G03 需求措辞已同步 |
| [第四轮技研审核](../../review/review-20261110-1753.md) | 2026-11-10：G01／G03 关闭；G02 自动写回存在开放句柄丢失、中断后配置缺失等反例。用户决定改为只提醒、不自动写回；技术方案 v2／v3 混写已合并 |
| [补验 D 智能体与供应商](技研/补验D_智能体与供应商_20261111.md) | 2026-11-11 已完成 R1–R6：Claude 多模型可用 `modelPicker`、订阅/API 检测方法、Codex 订阅真实运行、SMG 经 Claude Code 真实运行、测试可用性方法、插件调用身份与版本固定问题；用户已对待讨论项做出决定（需求补记 6）；SMG 只适用 Claude Code（无 Responses），用户已确认 Magpie 中的“Ultrapwor云”就是 SMG，Codex 可经 Magpie 使用 |
| [补验 E 智能体权限](技研/补验E_智能体权限_20261111.md) | 2026-11-11 用户提出 F31（现为需求 5.3「权限档位」）后开展：结论可以做，各档均已实跑（含用户要求的 Codex 完全访问）；Codex 帮我批准经同一供应商审查、失败不执行；Claude `auto` 在第三方（含 zenmux 实测）下不完整，交互界面留在 auto 后改为逐个批准；补测 E8–E12 发现 Codex“只读”同样须指定由用户审批；档位与规则用户已决定（见需求补记 8，Claude 暂不提供帮我批准）；过程中误触 Codex 自动更新（已按用户选择修复，见记录） |
| [补验 F 跨配置目录恢复](技研/补验F_跨配置目录恢复_20261111.md) | 2026-11-11 按复核 2119 F02 开展：Claude 直接换配置目录 `--resume` 安全失败（不发请求、不新建会话）；把会话记录复制到目标目录后上下文完整、源文件不变；Codex 共用默认目录不涉及 |
| [技术方案 T1.0](技研/技术方案.md) | 唯一技术设计，已按补验 B／C 及第四轮审核修订；两项工程选择已定（Claude `--permission-mode default` 采用、Codex 项目级 Skill 按条件采用） |
| [原型 P0.24（WillYou 设置分组同步）](原型/原型说明与变更.md) | P1 必需的终端写确认、迁移失败与默认缺失状态已补齐并保存合成浏览器证据，未计实际 App 或像素一致；既有 P0.20 历史： 2026-11-11 P0.20 按复核 review-20261111-2134 K01 修正：更换已有 Key 时增加身份修订号；P0.19 按复核 review-20261111-2119 F01 修正：原智能体来源已变时恢复须重新选择；P0.18 按审核 review-20261111-2023 修正恢复模型、恢复连接与缺 Key 启动；P0.17 新增首页智能体权限（需求 5.3「权限档位」，已评审：Codex 三项、Claude 两项、不提供自定义）；插件目录／详情、技能（Skill 与 MCP）、设置中的智能体，入口 `?preview=m13`；2026-11-11 插件目录与详情按 Codex 截图像素级对齐（逐项测量核对通过），其余差异见原型说明；2026-11-11 P0.3 用户认可；P0.4 按审核修正原型错误；P0.5 落实七项讨论结论与审核待补设计；P0.6 重新设计 Code Agent 配置；P0.7 调整入口（技能、智能体移入设置）；P0.8 图标栏四项、插件详情按启用状态、插入会话与统一会话生效提示；P0.9 插件安装与更新分开、不允许降级（可卸载后装旧版回退），首期不提醒新版本；P0.10 补全停用插件页面、项目关闭插件、受影响会话数与更新停用插件；P0.11 项目页“插件”分区按内置／外部分页签；P0.12 订阅/API 按登录方式检测、模型可用性按工具记录、官方图标、SMG 真实接入；P0.13–P0.15 智能体的创建与管理（手动三步新建、模型多选、同一组合唯一、默认固定第一），2026-11-11 用户确认原型；P0.16 按[审核 1500](../../review/review-20261111-1500.md)修正 N01–N09（需求补记 7），并按用户追加调整首页智能体选择器（图标、居中紧凑下拉）与输入框（最多 10 行），**待 Codex 复核与用户评审** |
| [验收基线 V0.1](验收/测试用例.md) | 2026-11-11 基线，覆盖 R01–R06（关联列已改为 R1.0 章节号）、P1 门槛与回归，实际状态统一见用例账；执行条件已确认（第 4 项：官方 API Key 不测、Codex 订阅可测、Claude 订阅由用户单独测）；M13全部已确认范围已于2026-11-12获开发／测试／修复授权 |
| 正式开发／验收／交付 | P1 门槛完成，结果见唯一用例账与[交付说明](交付说明.md)；其余M13已授权并开始实施，当前结果见唯一用例账；未发布 |

说明：A1–A5 行中的“已完成”指补验本身已执行；被第二至四轮审核指出的缺口由补验 B／C 及第四轮审核决定收口，以较新的记录为准。[第五轮审核](../../review/review-20261110-2325.md)确认无遗留阻塞，技研收尾，进入原型与用例。

下一步：按[唯一用例账](验收/测试用例.md)接续T064双CLI实际模型恢复与T080插件生命周期；FLOGIN自主I/A尾段已[补齐](验收/证据/M13-FLOGIN-remaining-A-20261114-a1/coordinator-verdict.json)，真实订阅/官方任务仍保留缺项。T064发现并修复Codex换供应商恢复时原生标识缺失，App048实测进一步发现当前标识比较只读门；最终标识兼容修复已通过[相关回归及App049构建审计](验收/证据/M13-Codex-resume-current-ID-fix-App049-20261114-a1/coordinator-verdict.json)，原完整A复验继续；T080同活S1停用拒绝、重启用及原生Worker热更新I已验，其余生命周期继续，旧红保留。用户最新安排：外出期间自主完成无需本人参与的测试，人工安全验证放最后。T024、T029 已完整归账；T025 真实键盘、T061 实际 App 并发与其余原合同继续，已完成的现场证据仍有效。

本轮AI调度与资源交接见[轮次记录](验收/并行测试/轮次/M13-AI-20261112T151240Z-96e267/轮次记录.json)；用例判定仍只维护在原验收用例账。

当前已完成：

- 包校验与声明式页面组：[完整 ZIP 检查及安装](验收/证据/P1-App005-complete-zip-20261112-a1/environment.json)、[非法包拒绝](验收/证据/P1-App005-invalid-20261112-a1/environment.json)、[真实列表／详情及精确 PID 原生键](验收/证据/P1-App005-declarative-20261112-a1/environment.json)。真实连接表单使用未替换的 OS safeStorage。
- [真正旧版数据升级及重复启动](验收/证据/P1-App005-real-upgrade-20261112-a1/environment.json)：旧数据、凭据引用／密文与迁移哈希核对通过，重复启动幂等。此前 SDK 阻塞已定位为独立 HOME 没有默认钥匙串，通过专属 OS 合成钥匙串解决，日常设置未变；原始失败记录保留。
- [迁移失败回滚与下次正常启动恢复](验收/证据/P1-App005-migration-rollback-20261112-a1/environment.json)：真实失败提示、原数据保全、旧内置两认证读取和重试迁移均已核对。复制协调门闩引起的隔离夹具拒启已修正，未改变产品保护。
- [沙箱不可用的真实内核故障与界面拒启](验收/证据/P1-App005-sandbox-unavailable-20261112-a1/environment.json)：无子进程与数据变更，真实UI提示和收尾已验；正常沙箱阳性对照沿用同包有效证据。
- [真实 Codex 合成禅道 Token 只读子流程](验收/证据/P1-codex-real-zentao-20261112-a1/environment.json)：Native／Host／HTTP 与完整资源续读经离线核对，仍不代替完整业务 UI、历史恢复、密码与切连接、默认交互写确认。

本轮已登记测试 App、旧包种子及 F-ZT 监听已收尾；其他同名既有进程未操作，私有合成数据与旧快照保留。用户持续批准本轮隔离测试，并明确允许准确 PID 的首次激活与指定原生按键；同范围不重复询问，工具自身审查不得绕过。原生工具按同名程序定位有歧义，不据其结果操作日常实例；实际输入仍要求准确进程及稳定焦点，运行中失焦停止。

导航：[里程碑索引](../README.md)。

本轮[并行准备轮次](验收/并行测试/轮次/M13-P1-20261112T032307Z-d528d0/轮次记录.json)用于T007与T001／T012准备，执行者不占桌面或运行资源。原生选择器批次先保留缺项，转系统隔离／CLI测试；[定位诊断](验收/证据/P1-native-picker-binding-20261112-a1/environment.json)不计新增通过。

最新接续：[App005 原宿主隔离及真实 SDK 补验](验收/证据/P1-App005-isolation-sdk-20261112-a1/environment.json)与[默认终端回执](验收/证据/P1-claude-default-receipt-20261112-a1/environment.json)已归档；整条状态仍见唯一用例账。该批结束时桌面锁屏，界面项目暂放；后续已恢复，见文末接续。本批自有进程和专属 SDK 测试钥匙串已清理。下一步见[P1 执行计划](验收/P1执行计划.md)。

后台新增：[T014真实模型密码认证子流程](验收/证据/P1-codex-password-real-20261112-a1/environment.json)已通过，Token R 证据继续有效；实际界面与切连接仍未完成，整条结果维持原账。

历史执行条件（后续已恢复后台CDP）：[锁屏与收尾复核](验收/并行测试/轮次/M13-P1-20261112T032307Z-d528d0/阻塞复核_20261112.json)。可独立补齐的本轮后台项已归档，剩余实际 App／系统验收需桌面可用；P1 未完成，解锁后按现有计划接续。已有测试授权持续有效。

恢复：用户明确“继续P1”，只读确认桌面可用。沿用既有候选与测试授权，新实例先补T005非空失败更新；原阻塞复核保留为历史，不重放旧输入。

新增完整验收：[T005非空失败更新回滚及旧版后续调用](验收/证据/P1-App005-failed-update-nonempty-20261112-a1/environment.json)已通过；唯一结果账已同步。

- T007已完成SDK写完整对照与独立复核，详见[执行记录](验收/执行与缺陷记录.md#2026-11-12-t007-sdk写对照收口)。下一步仍按P1执行计划推进真实生命周期及原生任务；正式统计以[唯一用例账](验收/测试用例.md)为准。

- T014已由[完整实际界面](验收/证据/P1-App005-zentao-ui-20261112-a1/environment.json)与[打包App真实模型](验收/证据/P1-App005-zentao-real-model-20261112-a1/environment.json)共同收口。正常退出与临时登录副本清理已核对，当前所有本轮执行资源释放；下一步集中剩余P1默认审批／在途生命周期／异常隔离／旧原生历史，不推进其余M13。

- 2026-11-12用户确认将纯Electron后台CDP与前台系统操作分开，并授权副屏自主隔离测试，规则已同步根AGENTS与公共流程。[新模式实际预检](验收/证据/P1-background-cdp-20261112-a1/environment.json)和[T004历史恢复子流程](验收/证据/P1-App005-history-resume-20261112-a1/environment.json)已归档；未完成的原生步骤不阻塞其他就绪后台组，不提升未齐整条状态。

- 最新：T012 真实旧 v2 名称／结果契约缺陷已修复并有[软件复验](验收/证据/P1-legacy-v2-compat-20261112-a1/environment.json)，[真正旧 App 历史前置](验收/证据/P1-old-history-prerequisite-20261112-a1/environment.json)未通过，尚未发出 Bug 查询。整条结果未提升；继续统一 App007 后台验收，原生选择器缺项保留，不反复重跑同一失败。

- [App007 构建审计与原生加载](验收/证据/P1-App007-build-20261112-a1/environment.json)通过；后续统一复用该包。构建不提升整条用例状态，不安装或发布。

- [T010 App007 实际崩溃暂停、详情重启与其他插件／终端隔离](验收/证据/P1-App007-crash-restart-20261112-a1/environment.json)已按原合同和当前I完成归账；额外驱动断言误判保留原件并离线更正。剩余项目仍以唯一用例账为准。

- [T009 App007完整故障与Native未知结果验收](验收/证据/P1-App007-exception-limits-20261112-a1/environment.json)已完成归账；剩余仅T001／T004／T006／T012，按唯一用例账继续。

- [T012真正旧App H](验收/证据/P1-old-history-H-20261112-a1/environment.json)已产生实际旧工具调用／返回及Native历史，准确进程收尾已核；新版历史查看与恢复C继续执行，整条状态不变。

- 最新接续：[App008统一候选](验收/证据/P1-App008-build-20261112-a1/environment.json)已构建并审计／smoke通过，纳入[卸载在途回执与外部插件历史修复](验收/证据/P1-uninstall-receipt-fix-20261112-a1/environment.json)。T006先补实际修复复验，再连续T004／T001；T012旧历史UI已验，恢复查询结果未通过，按[原始判定](验收/证据/P1-current-history-C-partial-20261112-a1/result.json)保留缺项，不重发未知C。


- 最新：[T006完整验收与App009活动来源兼容修复](验收/证据/P1-App009-uninstall-complete-20261112-a1/environment.json)已归账；下一步只补T001／T012，状态统一见用例账，不重复已通过项目。


- 最新：[T001连续宿主双端验收](验收/证据/P1-App008-two-agent-closure-20261112-a1/environment.json)已按原I／A／S归账；仅剩T012，系统前置已在同一App009成功，原历史新E已返回并正常收尾，正在独立核对完整业务结果。


- 最终：[T012原历史恢复完整验收](验收/证据/P1-App009-old-history-complete-20261112-a1/environment.json)归账，P1已收口；参见[交付说明](交付说明.md)。


最新接续（2026-11-13）：[双向 MCP 原生链复核](验收/证据/M13-CAP-T036-T038-native-20261113-a1/coordinator-verdict.json)与[普通任务界面回归](验收/证据/M13-AI-App019-T072-20261113-a1/coordinator-verdict.json)已归账；资源已释放。下一步为插件新 UI／旧入口清理、内置连接与项目规则和标准技能调用补验。新 UI 未验收，不宣称 M13 开发完成；需要用户的系统／真实账号项集中最后处理。

App020 插件 UI 候选已完成[统一构建、源码审计与原生冒烟](验收/证据/M13-UI-App020-build-20261113-a1/coordinator-verdict.json)，未装机。正在同包批量执行插件新目录／单一详情的自主 A；软件检查不计正式用例通过。

最新实际 App 接续：[T019／T081 完整 A 与 T020 部分](验收/证据/M13-UI-App020-A-20261113-a1/coordinator-verdict.json)已归账，测试资源已释放。App020 后的图标布局／业务任务交接修正在源码待新包；继续内置连接、项目插件规则、标准技能加载和原入口迁移，不宣称完整视觉或 M13 开发完成。


2026-11-13 本批接续：[App025 刷新 T098](验收/证据/M13-App025-T098-20261113-a1/coordinator-verdict.json)已完成原 A 并归账，后续 T021 原示例保留草稿追加证据、只补尾段。统一候选构建见[App024](验收/证据/M13-App024-build-20261113-a1/coordinator-verdict.json)与[App025](验收/证据/M13-App025-build-20261113-a1/coordinator-verdict.json)；标准 Skill 实际调用仍需补齐，不因构建与软件检查通过写为完成。


2026-11-13 批次完成：[T021 插件详情完整 A](验收/证据/M13-App025-T021-20261113-a1/coordinator-verdict.json)已归账；[T070 标准 Skill](验收/证据/M13-App024-T070-partial-20261113-a1/coordinator-verdict.json)只归部分结果，缺项与三轮驱动失败保留。所有资源已释放；继续原未完成范围，M13 尚未开发验收完成。

2026-11-13 App026 接续：视觉原红修复已同步共享原型 P004，真实复验继续；Claude 生成参数误拒已通过软件及实际 runtime 检查，工具调用仍待固定 peer 路由修正后补验。见[本批执行记录](验收/执行与缺陷记录.md#2026-11-13-app026-视觉修复claude-参数识别与原生回归)，正式结果仍只取用例账。

2026-11-13 最新复验：[T017／T018 App026 与 P004 视觉复验](验收/证据/M13-App026-T017-T018-20261113-a1/coordinator-verdict.json)已完整归账，原红及截图色彩配置、栅格差与原型元数据勘误均保留。继续标准 Skill 的 Claude 原生调用尾段及本机检测／智能体编辑／缺失 CLI 恢复批次；正式数量只取[唯一用例账](验收/测试用例.md)，M13 尚未完成。

[App027 统一候选](验收/证据/M13-App027-build-20261113-a1/coordinator-verdict.json)已完成构建、审计与原生加载，纳入 CLI 检测提示修正；检测／编辑／缺失恢复及项目 Skill 链接批次继续。未装机、未发布，正式结果只取原账。

2026-11-13 最新归账：[T045／T054 本机检测与智能体编辑](验收/证据/M13-App027-T045-T054-20261113-a1/coordinator-verdict.json)完整通过；项目 Skill 提示及原生插件归属修复已有[软件红绿证据](验收/证据/M13-T032-T068-software-20261113-a1/coordinator-verdict.json)，等待统一包复验。T091 已归部分结果、仍缺新检测提示的可见证据；继续 T032 同数据尾段复核及 T050／T051 共用接入组；不把软件测试计为实际 App 通过。

最新统一候选已更新为[App028](验收/证据/M13-App028-build-20261113-a1/coordinator-verdict.json)，待补T032两处详情提示；[T032原包投影与取消结果](验收/证据/M13-App027-T032-partial-20261113-a1/coordinator-verdict.json)已部分归账。链接创建、worktree排除与原件保护不再重复执行；其余就绪组继续按原合同批量。

最新：[T032项目Skill完整验收](验收/证据/M13-App028-T032-complete-20261113-a1/coordinator-verdict.json)已归账，App028提示原图及旧包投影适用性核齐。全部执行资源释放；继续供应商接入／错误组与T091提示补验，独立准备项目隔离及MCP环境过滤。


2026-11-13 当前接续：项目隔离T031已完整归账，T037实际同名Key分支留在官方CLI首次确认门，暂停该分支并继续独立项。App028供应商错误组与通知裁切原红已归档；修复的软件回归与类型检查通过，统一构建App029后先补T091完整可见通知，再接供应商成功／错误复验与原生插件发现纳管。系统确认不反复重试，不提升缺项；正式数量只见唯一用例账。


2026-11-13 App029 实际接续：T091 原裁切缺陷已用未放宽的同期可见判据复验并完整归账，不再重复。供应商同包先核错误文案，再做一次专属公开测试钥匙串预检；无法自主满足系统前置则保留缺项。另一组仅离线准备T068原生插件的Skill／MCP发现纳管及原生调用，不占桌面或重建包。


2026-11-13 当前接续：T031／T091本批已完整归账，T068实际Skill两调用成功但MCP工具未发布，已部分归账，下一步只读原生warnings定位。T050／T051错误文案新包通过，成功保存仍留系统安全存储前置未知缺项，不反复重跑。T057原证据只证明独立根及I层部分判据，最小A进程观测首轮在保存exe前断言停止，原件保留；准备先留准确同PID观测再有界等待exec，不放宽身份／不追造旧扫描。生产输入App029仍3107项一致，无新构建／装机／发布。正式统计仍只取唯一用例账。


2026-11-13 最新：T057完整隔离、T068实际MCP及T093用户新入口规则已完整归账，见唯一用例账和执行记录。统一App030及97项软件回归有效，全部自有执行进程已清场。供应商系统预检在用户解锁后的新实例仍未知，成功保存留后，不继续反复触发；下一独立准备为T058恶意项目设置隔离、T043双Agent源工具审批，批准范围不变。


当前接续（2026-11-13）：原生S在工具启动前置超时，未执行输入；已核收尾并保留缺项。合法合成连接的NoKC Host前置及通知文案软件修复已完成，App035统一构建中；先补真实运行会话计数A，原生启动仅安排一次新尝试。进度与边界见[执行记录](验收/执行与缺陷记录.md#2026-11-13-app034-原生-s-启动阻塞与-nokc-前置复核)，正式通过只取唯一用例账。

App035统一包已[构建审计及六项原生检查通过](验收/证据/M13-App035-build-20261113-a1/coordinator-verdict.json)，真实运行会话A继续准备。提示文案仅软件修复完成，保留实际App复验缺项；后台驱动和原生步骤分别调度，不占用日常实例。


最新：[T085 实际 S1、两 Skill 与准确 N1 提示](验收/证据/M13-App035-T085-partial-20261113-a1/coordinator-verdict.json)已归部分结果。最后拒绝判据被驱动错误阻断，本路径暂停迭代，资源已释放；继续独立的供应商错误集成及原生窗口观察。完整数量与缺项仍只见唯一用例账。


当前接续：[T051 非打包失败边界](验收/证据/M13-T051-failure-boundary-20261113-a1/coordinator-verdict.json)已补证，仍缺正式完整层级；[原生048](验收/证据/M13-App034-native-visual-failed-20261113-a1/coordinator-verdict.json)夹具未启动隔离App，额外启动错误窗的关闭被自动审批拒绝，清理保持未解决。停止原生输入，继续独立后台默认审批非交互组；正式统计仍取唯一用例账。


最新后台补证：[T042 Codex非交互原生拒绝](验收/证据/M13-T042-NI-partial-20261113-a1/coordinator-verdict.json)已归档，退出回执及Claude分支缺项保留，本路径停放。继续独立项复核与下一组准备；当前正式状态取唯一用例账，原生048清理未解决。


T056已依据[固定版本私有策略入口复核](验收/证据/M13-T056-private-policy-limit-20261113-a1/coordinator-verdict.json)登记技术阻塞，保留原零外连要求；其余独立测试继续。当前App035同源标准软件全量回归运行中，T061四任务夹具仅离线预检，无正式结果提升。


最新：[T061四任务实际I](验收/证据/M13-T061-four-task-I-20261113-a1/coordinator-verdict.json)已归部分结果，稳定启动前置与未解决的原冷迁移竞争均保留；[邮件旧前置修正及三项绿测](验收/证据/M13-mail-fixture-cas-software-20261113-a1/coordinator-verdict.json)已留证，整文件回归仍运行。生产包035未改，独立准备T060失败/隔离原I；完整状态只取原账。


[邮件整文件必要软件回归](验收/证据/M13-mail-regression-complete-20261113-a1/coordinator-verdict.json)已完成，原红及测试前置修正可追溯；继续T060原失败/认证隔离集成，准备已就绪、真实批次未执行，同版CLI的后台请求风险先核对。M13仍按原全部范围推进，正式状态只取用例账。

最新接续（2026-11-13）：[App036受管Claude最小修正](验收/证据/M13-App036-Claude-autoinstall-fix-20261113-a1/coordinator-verdict.json)与[T060六分支真实I](验收/证据/M13-T060-six-branch-I-20261113-a1/coordinator-verdict.json)已归档；原CDN红及驱动失败保留。下一步为显式Skill投影短回归、原T060打包App A，仍保留T056官方CLI技术阻塞与T061冷启动竞争。正式状态只取唯一用例账，不宣称M13完成。

[App036显式Skill短回归](验收/证据/M13-App036-explicit-Skill-I-20261113-a1/coordinator-verdict.json)已实际通过，关闭官方市场自动安装后，生产纳管投影的Skill仍可通过真实CLI激活、与标准库并存；不抵标准Skill完整业务或App层。继续T060原A缺项准备，正式结果仍取唯一账。

最新完整收口：[T071 App036浏览器实际A](验收/证据/M13-App036-T071-browser-complete-20261113-a1/coordinator-verdict.json)已归账；T060首页缺Key与首CTA已验，历史sourceChanged保护保留并补真实重选，界面补Key／OS层仍缺。软件回归只改一处旧测试期望，原产品文案与确认原型一致，剩余文件继续；不重建／装机／发布。

[本批改动软件回归](验收/证据/M13-affected-software-complete-20261113-a1/coordinator-verdict.json)已按原文件集合收口，两个旧测试问题修正后全部实际执行；不代替正式App／系统层。T060缺KeyA及T071浏览器完整A已归档，下一自主批为T085真实运行会话影响与拒绝，涉及系统凭据的补验继续列最后。

最新：[T037同名模型Key完整实际补验](验收/证据/M13-App036-T037-collision-complete-20261113-a1/coordinator-verdict.json)已归账。T085发现全局成功提示落到视区外的真实缺陷，[App037最小修正与构建](验收/证据/M13-App037-global-notice-fix-20261113-a1/coordinator-verdict.json)的软件/类型/审计/原生层已通过，待实际完整复验；不把构建成功当用例通过。


最新：[T085原I＋A完整复验](验收/证据/M13-App037-T085-complete-20261113-a1/coordinator-verdict.json)已归账，全局成功提示视区缺陷经实际App037关闭，原红保留。继续Claude默认审批非交互剩余I及系统／用户前置分组；M13未完成，正式进度仍以唯一用例账为准。


T042 Claude非交互默认审批的[真实I尾段](验收/证据/M13-T042-Claude-NI-I-20261113-a1/coordinator-verdict.json)已补齐，交互A／系统缺项保留；后续继续T065及正确HOME供应商保存批的准备，已通过结果不重复。当前用户前置分组私有只读清单已形成，待核启动隔离，不将普通公开Key确认误列为必须本人。


[T070标准Skill回归完整补验](验收/证据/M13-App037-T070-complete-20261113-a1/coordinator-verdict.json)已归账，最后项目上下文MCP原生回执补齐；历史有效段按源码适用性沿用、未重复执行。继续T065及供应商正确HOME隔离准备，不扩大权限或以Mock代替原生结果。


当前接续：T070已完整归账，T063界面拒绝与T065首配置真实模型切换已补部分结果。旧术语／已确认删除入口及正确OS HOME下的子CLI/发现根隔离已有[软件差分与回归](验收/证据/M13-child-home-and-deleted-entry-software-20261113-a1/coordinator-verdict.json)，等待统一App039实际复验；[外层OS隔离失败](验收/证据/M13-correct-HOME-OS-preview-red-20261113-a1/coordinator-verdict.json)保留、不削弱Electron沙箱。T065提醒续接不重跑已有效首根模型，系统验证仍在最后。


[App039统一候选](验收/证据/M13-App039-unified-build-20261113-a1/coordinator-verdict.json)已构建／签名与内容审计／六原生烟测通过，纳入正确OS HOME与子CLI路径分离、插件称谓和已删除入口；实际UI尚待复验，不以包成功提升正式用例。准备先无保存隐私边界预检，再接T065原notice与余四配置；原038未验即取代、所有原红均保留。


[App039正确OS HOME与私有子CLI／发现根预检](验收/证据/M13-App039-correct-HOME-preview-20261113-a1/coordinator-verdict.json)已实际闭环，不触安全存储或模型，后续系统保存前置不再卡在隔离启动。T065原提醒续接与余四配置正在095批执行；正式统计仍取唯一账，预检不增加通过数。


2026-11-13 最新自主补验：[T065完整自主A及T073受影响入口]( 验收/证据/M13-App039-T065-A-T073-affected-20261113-a1/coordinator-verdict.json )已归档，整条均保留缺项。T065非打包集成正在接续；系统复制/外开和完整T073清单不冒充完成。正式统计仅取测试用例账。


当前接续：[T078完整配置UI](验收/证据/M13-T078-complete-20261113-a1/coordinator-verdict.json)已归账，连同T050、T051完成本批收口。下一自主批集中T079自定义供应商、T090模型可用性；会话插件完整原型对齐及T080生命周期仍待完成。正式进度只取唯一用例账，App040为隔离测试端点变体，不作发布包。

[T079完整自定义供应商](验收/证据/M13-T079-complete-20261113-a1/coordinator-verdict.json)已归账，系统加密保存与双端确认均实测。下一批集中T090模型可用性（先修已复现的重试成功说明缺失）与T052刷新/下线；尚未完成的会话弹窗及生命周期继续保留。当前统计只取唯一用例账。


2026-11-14 自主接续：钥匙串与真实账号／本人操作按用户睡眠安排放最后；[T061冷启动定位与候选判据](验收/证据/M13-T061-cold-DDL-preparation-20261114-a1/coordinator-verdict.json)仅为研发准备，尚未修改生产启动同步，不取代原红。T073窄窗footer已按实际红串行CSS修复，[统一App046实际复验](验收/证据/M13-T073-App046-footer-recheck-20261114-a1/coordinator-verdict.json)已通过窄窗固定头尾/正文滚动及四视图子集，完整T073仍保留缺项。

2026-11-14 夜间接续：[T088/T092登录提示软件](验收/证据/M13-T088-T092-login-hints-software-20261114-a1/coordinator-verdict.json)及[统一App047](验收/证据/M13-App047-login-hints-build-20261114-a1/coordinator-verdict.json)已完成；无凭据FLOGIN实际I/A与T064恢复I接续，所有钥匙串/密码/本人操作留明天。正式结果仍取唯一用例账，不把软件或局部A算整条完成。

2026-11-14 无凭据测试结果：[T088/T092真实FLOGIN I](验收/证据/M13-T088-T092-FLOGIN-I-20261114-a1/coordinator-verdict.json)已核对归档，打包UI与真实订阅/系统层仍缺；仅增加实际部分结果，未增加完整通过数。

2026-11-14 本批归档：[T088打包A与T092驱动环境红](验收/证据/M13-T088-A-and-T092-driver-env-red-20261114-a1/coordinator-verdict.json)、[T064真实Read/恢复前复制部分I](验收/证据/M13-T064-real-Read-copy-partial-20261114-a1/coordinator-verdict.json)均保留全部缺项。测试自有进程/监听已独立确认收尾，不动历史未知归属App。两组按本批驱动重试上限停放，未增加完整通过数；尚可自主补的A/恢复尾段与需本人操作的钥匙串/真实订阅分开记录，后者明确留明天。


2026-11-15 当前接续：T030第三方用户Skill实际App A已补齐（[424](验收/证据/M13-T030-third-party-user-Skill-complete-App057-A-424-20261115-a1/coordinator-verdict.json)），本人订阅R仍缺；T064原③实际App已齐（[425](验收/证据/M13-T064-crossroot-III-complete-and-default-welcome-fixture-red-425-20261115-a1/coordinator-verdict.json)），仅接④默认目录业务/同名保护。原红保留，同包继续，不重复已通过部分。正式状态只取唯一账，M13尚未完成。


2026-11-15 最新：[427默认恢复与同名拒绝、原历史追加差异](验收/证据/M13-T064-default-ACK-collision-and-Native-history-criterion-gap-427-20261115-a1/coordinator-verdict.json)已完成原默认恢复/同名保护业务；仅“CLI自身正常追加全局历史”与原hash判据的边界待用户确认，原结果仍部分通过。继续自主T094模型菜单缺项准备，不重跑T064有效结果。检查点`9c186738c`已推送；原包不变。


2026-11-15 最新正式收口：[430原完整U/I/A联合与用户边界确认](验收/证据/M13-T064-original-full-contract-union-user-clarified-history-430-20261115-a1/coordinator-verdict.json)已归账。用户确认CLI正常追加历史与宿主保护的边界，原需求/方案/用例同步，原红保留且无重跑。继续T094自主菜单缺项，真实账号/服务输入留后；正式数量只取唯一用例账，M13尚未完成。


2026-11-15 最新接续：[T030 本期完整联合](验收/证据/M13-T030-thirdparty-complete-user-deferred-subscription-435-20261115-a1/coordinator-verdict.json)与[T048 真实 Flash 完整验收](验收/证据/M13-T048-real-DeepSeek-Flash-full-436-20261115-a1/coordinator-verdict.json)已归账。Claude 订阅后补边界见[需求第6章](需求.md)；实际状态只取[唯一用例账](验收/测试用例.md)。继续补 T092 官方 Native API 环境与 T088 真实登录校准，M13 尚未完成，无发布。


2026-11-15 接续：[T092 本期完整联合](验收/证据/M13-T092-official-Native-api-env-user-subscription-excluded-439-20261115-a1/coordinator-verdict.json)已归账；Claude 订阅验证按[最新范围决定](验收/证据/M13-T092-official-Native-api-env-user-subscription-excluded-439-20261115-a1/user-decision.json)取消，纯订阅 T059 单列。当前进度只取[唯一用例账](验收/测试用例.md)。继续 Codex 登录校准与其余 Provider、权限任务，无发布。


2026-11-15：[T088 原完整联合](验收/证据/M13-T088-original-complete-real-Codex-status-calibration-441-20261115-a1/coordinator-verdict.json)已收口；当前原部分通过用例已全部完成本期要求，Claude 订阅取消项保持显式记录。继续剩余真实 Provider、任务快照、模型切换与权限验证，状态以[唯一用例账](验收/测试用例.md)为准。


2026-11-15 最新统一基线 source012／App058：[T055真实双端快照与即时删除提示](验收/证据/M13-T055-real-both-CLI-snapshot-delete-event-fix-App058-448-20261115-a1/coordinator-verdict.json)已完整通过。原缺少变更事件已修复，包只重建一次，原失败保留。正式进度仍只取[唯一用例账](验收/测试用例.md)，继续其余网关、模型切换与权限矩阵，无发布。
