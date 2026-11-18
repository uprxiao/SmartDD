# M14 阶段 1–5 整体复核修复回执

2026-11-18，`feature/0.1.6` 本地工作区。依据为[Claude Code 整体复核](review-20261118-claude-阶段1-5整体复核.md) §3 和 §6，以及[需求](../里程碑/M14_统一Agent工作区/需求.md)中 2026-11-18 的已确认勘误。已核对 R06、R09、R10，本轮未编辑需求。用户于 **2026-11-18** 确认 P0.20 界面接入 App，正式 A／R／S 验收沿用阶段 6 的安排。本轮未推送。

## G1–G5

| 项目 | 实现与证据 | 剩余 |
| --- | --- | --- |
| G1 项目删除 | 主进程预检返回任务数、归档数、代码目录、工作副本和逐任务阻塞原因。数据库事务删除该项目的 M14 记录并登记资源清理，保留 M13 调用记录和运行历史关联；等待收口期间再次校验。定向测试覆盖待批准拒绝、父子及归档记录删除、Git 别的引用和工作副本保留、暂不可访问后重试。[项目删除代码](../../src/main/core/agent/project-resources.ts) · [集成测试](../../src/main/core/agent/project-resources.test.ts) | App 已接入确认框和拒绝提示，确认提交主进程预检摘要。[接线](../../src/renderer/views/projects/project-actions.tsx) |
| G2 快照与附件 | Git 仅删除本库登记并且匹配提交的快照引用。私有影子库压到 1 GiB 前按归档优先、最早优先回收，绕过读租约，捕获与清理共用工作根队列。已增分页、精确轮次、查看租约接口。附件保留仍引用副本，删除项目、草稿移除和取消输入时回收无引用副本，并清理超过 24 小时的无引用副本。[快照服务](../../src/main/core/agent/turn-diffs.ts) · [资源服务与重试](../../src/main/core/agent/project-resources.ts) · [集成测试](../../src/main/core/agent/project-resources.test.ts) | App 差异分页、精确轮次、查看租约和首页移除附件均已接入。原型已验证第 1 轮和 54 轮选择。[差异面板](../../src/renderer/features/agent-tasks/workspace-panels.tsx) |
| G3 方案 C | 默认共用目录串行，保留未提交改动和原会话，宿主不提交；显式独立模式从 HEAD 创建并返回基准及未提交文件数，只提交子分支。移除 R1 自动提交及同仓库输入闸门。完成交接记录可列上一位写入者的文件。测试覆盖默认共用、显式副本、同仓活动回合或目标、`wy_send` 续用绑定。[委派](../../src/main/core/agent/delegation-service.ts) · [Git 工作副本](../../src/main/core/agent/git-workspaces.ts) · [委派回归](../../src/main/core/agent/delegation-service.test.ts) | App 时间线和任务关系已接入模式标识。真实模型的自然语言传参与三轮往返，以及权限组合均在 A80–A85 验收。[关系视图](../../src/renderer/features/agent-tasks/agent-relations.tsx) |
| G4 创建目录 | IPC 按 `projectId`＋`dirId` 选取未归档项目的真实目录；渲染端传来的 `cwd` 被忽略。测试覆盖错误 cwd 被纠正、跨项目拒绝、归档项目拒绝、目录消失拒绝。[IPC 和主进程目录](../../src/main/core/agent/controller.ts) · [注册目录实现](../../src/main/core/agent/wiring.ts) · [集成测试](../../src/main/core/agent/project-resources.test.ts) | 无界面增量。 |
| G5 已归档任务 | 主进程支持列表、父子原子归档恢复及单独恢复子任务，保留原生绑定；已归档可读取快照、历史和差异，主进程拒绝发送、草稿修改等写入。[任务服务](../../src/main/core/agent/agent-task-service.ts) · [归档集成测试](../../src/main/core/agent/project-resources.test.ts) | App 已接入设置、只读页、撤销和侧栏隔离，并关闭搜索、项目历史和插件页面指向旧终端的跳转。[归档设置](../../src/renderer/views/settings/archived-agent-tasks.tsx) |

实现选择与边界

- 用迁移 `0038_agent_resource_cleanup` 保存待清理记录，以及已删除任务原有的运行身份。M13 调用记录继续引用原运行行。项目预检摘要校验是为确保用户确认时看到的删除范围和最终执行范围一致。[迁移](../../drizzle/0038_agent_resource_cleanup.sql)
- 历史字段和 R1 回归证据保留。未完成的旧自动提交意图标为待核实，恢复流程不再执行它。已登记的旧独立工作副本保留原工作目录与绑定。
- 原型截图使用合成数据，App 开发构建另按 UI 流程取证。生成账中的产品整条用例仍处于未执行状态。

## §6.2 原型逐行

| 复核清单 | 处理与证据 | App 状态 |
| --- | --- | --- |
| G1 项目删除确认与拒绝 | 展示任务数、归档数、保留路径、密码选项和拒绝原因。[确认截图](../里程碑/M14_统一Agent工作区/原型/截图/P0.20_20261118/README.md) | 已接入 |
| G2 差异面板 | `diff-history` 有 54 个选项，旧卡片按轮次打开，显示回收与容量状态。[原型 CDP](evidence-20261118-claude-phase1-5-fix/prototype-cdp.log) | 已接入 |
| G3 `team` | Git 默认共用目录，卡片和队列按写入交接呈现。[模型](../../prototypes/m6-codex/src/m14-model.mjs) | 已接入 |
| G3 `team-worktree` | 从当前提交派出，显示未提交文件提示和分支。与共用目录写入子任务同项目展示。[模型](../../prototypes/m6-codex/src/m14-model.mjs) | 已接入 |
| G3 `team-done`、`merge-check`、RV07 | 子分支结果、合并和工作副本横幅属于独立模式。[原型任务区](../../prototypes/m6-codex/src/M14TaskArea.jsx) | 已接入 |
| G3 任务关系与子任务卡片 | 逐条显示共用目录、只读或工作副本分支。[截图](../里程碑/M14_统一Agent工作区/原型/截图/P0.20_20261118/README.md) | 已接入 |
| G3 `team-rework` | 审查、修改、复核三轮使用同一个共用目录子任务。[模型回归](../../prototypes/m6-codex/tests/m14-model.test.mjs) | 真实模型往返待 A85 |
| G5 侧栏 | 新任务区隐藏旧任务分组。[原型侧栏](../../prototypes/m6-codex/src/ReferenceSidebar.jsx) | 已接入 |
| G5 设置页面 | 按项目分组，包括已归档项目，提供恢复和空状态。[原型设置页](../../prototypes/m6-codex/src/M14ReviewPanels.jsx) | 已接入 |
| G5 只读视图 | 顶部恢复入口，正文和差异可读，输入禁用。[截图](../里程碑/M14_统一Agent工作区/原型/截图/P0.20_20261118/README.md) | 已接入 |
| G5 归档提示 | 原型归档提示提供撤销。[原型 App](../../prototypes/m6-codex/src/App.jsx) | 已接入 |

## §6.3 技术方案逐行

所有条目见[T1.8](../里程碑/M14_统一Agent工作区/技研/技术方案.md)。

| 位置 | 处理 |
| --- | --- |
| §2 | 更新提交来源、归档／恢复事件、工作区模式、待清理记录；历史字段保留兼容。 |
| §3 | 定义委派模式、归档和恢复、项目删除预检以及登记目录创建。 |
| §6 | 方案 B 适用于三种目录的共用写入，说明按真实模式注入。 |
| §6.1 | 独立工作副本从 HEAD 创建，回执写出未提交文件数。历史 R1 作废。 |
| §8.1 | 等待当前操作的资格和准备不消耗执行时限，独立任务自己的工作照常进行。 |
| §9 | 增加清理重试和归档恢复，移除派出前自动提交的恢复动作。 |
| §11 | 差异分页、准确轮次、归档保留、私有影子库回收和读租约。 |
| §12 | 写明删除项目的前置、保留范围、所属资源的清理时机，以及附件的四类清理和保留。 |
| §13 | 登记 T1.8 依据及 T1.7 历史。 |
| 关联研究 | [验证计划 P1.9](../里程碑/M14_统一Agent工作区/技研/兼容验证计划.md)与[验证账 V1.8](../里程碑/M14_统一Agent工作区/技研/全局设计验证账.md)已同步 E11、E12、Q35、Q61、Q64。 |

## §6.4 用例逐行

以[生成器](../里程碑/M14_统一Agent工作区/技研/实验/20261116_复核修订验证/编制验收文档.py)生成[测试用例 A1.11](../里程碑/M14_统一Agent工作区/验收/测试用例.md)和[执行账 E2.3](../里程碑/M14_统一Agent工作区/验收/执行与缺陷记录.md)。X2 是满足 `trustedRead` 条件的第三方 Codex 配置。

| 复核清单 | 生成结果 |
| --- | --- |
| A13 | 新任务区侧栏无旧任务入口。 |
| A18、A75 | 草稿、队列、24 小时无引用、归档保留、项目删除五种附件判据。 |
| A30 | 三类目录默认共用，Git 可显式独立。 |
| A31、A32 | Git 共用目录纳入方案 B。 |
| A34 | 私有影子库的回收顺序、读租约和容量失败。 |
| A48 | 归档前置、父子归档和快照附件保留。 |
| A65 | 完整差异分页、卡片精确轮次、回收状态和保留未登记引用。 |
| A66 | 显式独立工作副本及 HEAD；同仓活动任务不阻塞，无主分支自动提交。 |
| A67 | 仅独立模式合并。 |
| A68 | 共用目录原会话三轮审查、修改和复核。 |
| A70 | 另一个任务开 Codex 目标时仍可委派。 |
| A74 | 工作区模式标识与混合场景。 |
| A77 | Git 共用目录、SVN 和普通目录均验证重读清单。 |
| A78、A79 | 项目删除和恢复归档，初始未执行。 |
| A80、A81、A82 | 平行开发、审查未提交设计、接着未提交接口实现，初始未执行。 |
| A83、A84、A85 | 检查当前改动、审查后直接改、多轮审查后开发，初始未执行。 |

## §6.5 和 §6.6 逐行

| 产物 | 处理 |
| --- | --- |
| §6.5 执行与缺陷记录 | G1–G5 和复验指针经 `EXEC_ROWS` 生成。保留 R1 历史及作废说明。A78–A85 未执行。 |
| §6.6 阶段入口 | 更新当前状态、复核／截图入口和后续步骤。[阶段 README](../里程碑/M14_统一Agent工作区/README.md) |
| §6.6 实施计划 | 登记本轮改动、2026-11-18 界面确认节点、归属用例及阶段 6 基线。[实施计划](../里程碑/M14_统一Agent工作区/实施计划与进度.md) |
| §6.6 阶段 3–5 交接 | 补入本轮复核状态和阶段 6 的现行用例入口。[交接说明](../里程碑/M14_统一Agent工作区/开发交接_阶段3-5_20261118.md) |

## §6.7 自测

证据见[本轮证据目录](evidence-20261118-claude-phase1-5-fix/)。见下方测试批次。阶段 6 的打包、真实模型和系统层专项仍按 A1.11 执行。

| 验证 | 实际结果 |
| --- | --- |
| 受影响回归 | 503 项通过、6 项按既有条件跳过，零失败。包含实际等待 61 秒的 FIFO 测试。[日志](evidence-20261118-claude-phase1-5-fix/logs/affected.log) |
| 渲染与定向用例 | 734 项通过，包含 M14 任务界面、项目确认、归档设置、插件引用入口及浏览器相关回归。与上一行有重叠，不相加。[日志](evidence-20261118-claude-phase1-5-fix/logs/renderer-and-focused.log) |
| 类型检查与开发构建 | 通过。首次在沙箱内的 LibreOffice 签名验证失败；在主机构建环境核验同一份缓存后原样复跑通过。[类型检查](evidence-20261118-claude-phase1-5-fix/logs/typecheck.log) · [最终构建日志](evidence-20261118-claude-phase1-5-fix/logs/app-build-final.log) |
| 原型构建与回归 | M14 30 项、M9 297 项、parity 5 项、M13 原型 57 项均通过。浅色、深色、窄窗 CDP 无渲染错误。[证据](evidence-20261118-claude-phase1-5-fix/README.md) |
| 开发 App CDP | 最终构建浅色、深色各通过 5 项，含窄窗。两次都正常退出，渲染端无报错。检查包括父子归档、撤销、只读、恢复，G1 拒绝和成功删除，以及两种工作区模式和早期轮次差异。配置和时序是合成数据。[浅色结果](evidence-20261118-claude-phase1-5-fix/app/final/light/app-cdp.json) · [深色结果](evidence-20261118-claude-phase1-5-fix/app/final/dark/app-cdp.json) · [截图](evidence-20261118-claude-phase1-5-fix/README.md#最终开发-app-复验) |
| 文档与生成一致性 | 审计 43 项通过，零失效链接。A1.11／E2.3 重生成逐字节一致，共 83 条，其中 74 条适用、9 条范围外。[审计](evidence-20261118-claude-phase1-5-fix/document-audit.json) · [生成日志](evidence-20261118-claude-phase1-5-fix/logs/generated.log) |
| 最后两处防竞态 | 任务服务与资源组重跑 60 项通过，当时未有活跃目标阻止删除与空闲会话关闭后删除的专项 I 层用例。附件准备回执迟到后释放副本的改动复跑附件与资源组 28 项通过。两批存在重叠。[删除复查](evidence-20261118-claude-phase1-5-fix/logs/delete-goal-recheck.log) · [附件复查](evidence-20261118-claude-phase1-5-fix/logs/final-touched.log) |
| M13 全量与复跑 | 完整单 worker 批次覆盖 153 个文件。2,375 项通过、9 项按原条件跳过、1 项超时。超时是上轮曾出现的 D11 邮件发送后回执未知用例，5 秒超时设置保持原样。单独复跑该用例通过。[全量日志](evidence-20261118-claude-phase1-5-fix/logs/m13-full.log.gz) · [结果摘要](evidence-20261118-claude-phase1-5-fix/m13-result.json) · [复跑日志](evidence-20261118-claude-phase1-5-fix/logs/m13-mail-retry.log) |

## 后续复核

R1–R6 修改、补测和阶段 6 前的原型状态对照见[修复复核回执](review-20261118-claude-阶段1-5整体复核-修复复核-回执.md)。新一轮的 G1 实际界面证据替代上一轮尚处于过渡动画的截图。
