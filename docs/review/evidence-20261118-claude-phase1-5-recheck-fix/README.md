# M14 阶段 6 前的原型状态对照

2026-11-18 复核更新：历史截图仍可按下表索引查阅。视觉与功能的结论以[逐状态差异清单](../evidence-20261118-claude-phase1-5-s1-s2/原型状态差异清单.md)为准；原表的“已修”仅对应写明的实现点。

2026-11-18 · macOS arm64 · 原型 P0.20 与同一工作区的隔离开发 App。左图原型，右图 App。浅色和深色均为 1440 × 900，窄窗为浅色 950 × 780。

比较以 `m14-model.mjs` 的 `SCENARIOS` 为索引。原型和 App 使用同一组消息、工具条目、计划、目标和任务关系数据；App 使用真实页面、项目归档、读取与导航入口。主进程隔离 SQLite 播种初始状态，流式案例投递合成推送，停止案例只在隔离 IPC 响应中注入等待计时，其余字段由真实服务生成。涉及状态选择及打开面板的操作使用后台 CDP 点控件。取证没有登录真实账户、运行模型或对外发起业务请求。

## 逐项对照

| 状态 | 核对结果 | 并排截图 |
| --- | --- | --- |
| done · S02 一轮完成 | 正常回合保留折叠工作过程、最终回答和改动入口。 | [浅色](side-by-side/light-done.png) · [深色](side-by-side/dark-done.png) · [窄窗](side-by-side/narrow-done.png) |
| starting · S02 刚开始（思考中） | 已修。App 现在显示思考提示与计时。 | [浅色](side-by-side/light-starting.png) · [深色](side-by-side/dark-starting.png) · [窄窗](side-by-side/narrow-starting.png) |
| running · S02 工作中＋排队 | 已修工作中展开。App 保留排队条目；对已排队的完整输入还缺逐项编辑、立即插话入口，见下文。 | [浅色](side-by-side/light-running.png) · [深色](side-by-side/dark-running.png) · [窄窗](side-by-side/narrow-running.png) |
| streaming · S02 输出最终回答中 | 合成增量经 App 事件通道进入实时回答，工作过程可见；流式光标外观不同。 | [浅色](side-by-side/light-streaming.png) · [深色](side-by-side/dark-streaming.png) · [窄窗](side-by-side/narrow-streaming.png) |
| approval · S03 命令审批 | 使用真实原生选项合同，批准本会话的范围随原生请求。原型选项为示例。 | [浅色](side-by-side/light-approval.png) · [深色](side-by-side/dark-approval.png) · [窄窗](side-by-side/narrow-approval.png) |
| question · S03 Agent 提问 | 问题正文、单选、自填与提交状态可见；App 表单依原生问题结构，键盘编号差异见下文。 | [浅色](side-by-side/light-question.png) · [深色](side-by-side/dark-question.png) · [窄窗](side-by-side/narrow-question.png) |
| switch · S04/S05 切换 Provider | 全量、增量交接和切换分隔可见；原型在回答上额外列来源组合名。 | [浅色](side-by-side/light-switch.png) · [深色](side-by-side/dark-switch.png) · [窄窗](side-by-side/narrow-switch.png) |
| team-worktree · S06/S12 独立工作副本（Git 并行） | 已修任务关系入口；工作副本名、共用目录和子请求来源可见。 | [浅色](side-by-side/light-team-worktree.png) · [深色](side-by-side/dark-team-worktree.png) · [窄窗](side-by-side/narrow-team-worktree.png) |
| team-done · S06 多 Agent 协作（结果回收与合并） | 已修任务关系入口；可回看已完成的子任务。模型合并执行留在正式验收。 | [浅色](side-by-side/light-team-done.png) · [深色](side-by-side/dark-team-done.png) · [窄窗](side-by-side/narrow-team-done.png) |
| team-svn · S06 多 Agent 协作（SVN 项目：写入串行） | 已修任务关系入口；写入走共用目录。实际 SVN 写槽调度另用 I 层验证。 | [浅色](side-by-side/light-team-svn.png) · [深色](side-by-side/dark-team-svn.png) · [窄窗](side-by-side/narrow-team-svn.png) |
| team · S06 多 Agent 协作（Git 共用目录） | 已修任务关系入口；由子请求点入子任务，卡保持展开并高亮，点主任务返回。 | [浅色](side-by-side/light-team.png) · [深色](side-by-side/dark-team.png) · [窄窗](side-by-side/narrow-team.png) |
| team-rework · S06 共用目录多轮复核 | 共用目录、任务回父及关系卡可见；合成数据仅展示一次完成记录。 | [浅色](side-by-side/light-team-rework.png) · [深色](side-by-side/dark-team-rework.png) · [窄窗](side-by-side/narrow-team-rework.png) |
| merge-check · S06 合并核对未通过 | 连续两次核对未通过的需要处理状态可见。真实 Git 判据以集成为准。 | [浅色](side-by-side/light-merge-check.png) · [深色](side-by-side/dark-merge-check.png) · [窄窗](side-by-side/narrow-merge-check.png) |
| stopped · S07 已停止 | 已修。停止轮次默认展开，并保留工作耗时尾注。 | [浅色](side-by-side/light-stopped.png) · [深色](side-by-side/dark-stopped.png) · [窄窗](side-by-side/narrow-stopped.png) |
| failed · S07 失败／接收未知 | 失败与接收未知分开展示，终态处可看工作过程。 | [浅色](side-by-side/light-failed.png) · [深色](side-by-side/dark-failed.png) · [窄窗](side-by-side/narrow-failed.png) |
| limited · S11 额度用完（照 T3） | 已修。额度或限流写已暂停，保留手动继续说明。到点自动继续按已确认规则省略。 | [浅色](side-by-side/light-limited.png) · [深色](side-by-side/dark-limited.png) · [窄窗](side-by-side/narrow-limited.png) |
| length · S11 输出长度上限 | 已修。保留部分回答并独立提示输出长度上限。 | [浅色](side-by-side/light-length.png) · [深色](side-by-side/dark-length.png) · [窄窗](side-by-side/narrow-length.png) |
| links · S10 消息链接 | 文件、目录、网页等文本经 App 链接组件呈现。保留现行链接安全规则；本轮只取界面状态。 | [浅色](side-by-side/light-links.png) · [深色](side-by-side/dark-links.png) · [窄窗](side-by-side/narrow-links.png) |
| business · S03 业务审批（插件／邮件） | 宿主业务审批使用插件写请求合成数据。真实邮件完整审阅与执行另验。 | [浅色](side-by-side/light-business.png) · [深色](side-by-side/dark-business.png) · [窄窗](side-by-side/narrow-business.png) |
| access · S03 跨任务网页授权（M12） | 跨任务浏览器授权请求面板可见。授权绑定和业务执行未在截图中操作。 | [浅色](side-by-side/light-access.png) · [深色](side-by-side/dark-access.png) · [窄窗](side-by-side/narrow-access.png) |
| extensions · S15 系统提示与用户扩展 | 系统提示、工作过程和插件入口可见；假数据的插件数量与原型不同。 | [浅色](side-by-side/light-extensions.png) · [深色](side-by-side/dark-extensions.png) · [窄窗](side-by-side/narrow-extensions.png) |
| stopping · S07 正在停止／强制停止 | 已修。停止进度、超时后手动强制停止可见；运行关闭和身份核对另由 I 层证实。 | [浅色](side-by-side/light-stopping.png) · [深色](side-by-side/dark-stopping.png) · [窄窗](side-by-side/narrow-stopping.png) |
| plan · S02 计划卡（Claude 自己交计划） | Claude 计划正文与批准、修改意见、拒绝同屏可见。 | [浅色](side-by-side/light-plan.png) · [深色](side-by-side/dark-plan.png) · [窄窗](side-by-side/narrow-plan.png) |
| todo · S02 待办清单 | 结构化待办含已完成、进行中和待处理项。 | [浅色](side-by-side/light-todo.png) · [深色](side-by-side/dark-todo.png) · [窄窗](side-by-side/narrow-todo.png) |
| goal · S16 目标进行中（Codex） | Codex 活跃目标、计时、轮次、暂停和清除可见。 | [浅色](side-by-side/light-goal.png) · [深色](side-by-side/dark-goal.png) · [窄窗](side-by-side/narrow-goal.png) |
| goal-wait · S16 目标＋子任务（自动暂停） | 等待子任务期间的暂停、任务关系与子请求可见。 | [浅色](side-by-side/light-goal-wait.png) · [深色](side-by-side/dark-goal-wait.png) · [窄窗](side-by-side/narrow-goal-wait.png) |
| goal-claude · S16 目标（Claude：只能清除） | Claude 目标只提供清除。开发夹具的模型标牌仍为合成配置。 | [浅色](side-by-side/light-goal-claude.png) · [深色](side-by-side/dark-goal-claude.png) · [窄窗](side-by-side/narrow-goal-claude.png) |
| compaction · S09 上下文压缩 | 已完成的上下文压缩分隔可见，本场景未触发原生压缩。 | [浅色](side-by-side/light-compaction.png) · [深色](side-by-side/dark-compaction.png) · [窄窗](side-by-side/narrow-compaction.png) |
| native · S06 执行器内置子 Agent | 已修。从工作过程打开并排只读区，任务区仍可操作；背景任务见下文。 | [浅色](side-by-side/light-native.png) · [深色](side-by-side/dark-native.png) · [窄窗](side-by-side/narrow-native.png) |
| diff-states · S13 改动记录的其他状态 | 准备中、差异不完整及不可用分别有文案；App 捕获进度以已读文件和字节为准。 | [浅色](side-by-side/light-diff-states.png) · [深色](side-by-side/dark-diff-states.png) · [窄窗](side-by-side/narrow-diff-states.png) |
| message-ui · S08 消息细节（代码块、附件、发送失败、草稿冲突） | 代码块、附件标签及合成发送失败均可见；真实冲突和附件系统操作另验。 | [浅色](side-by-side/light-message-ui.png) · [深色](side-by-side/dark-message-ui.png) · [窄窗](side-by-side/narrow-message-ui.png) |
| diff-history · S13 历史差异与空间回收 | 已修轮次名称。第 1 轮能精确定位，加载后可查 54 条；回收、空间不足带原因。 | [浅色](side-by-side/light-diff-history.png) · [深色](side-by-side/dark-diff-history.png) · [窄窗](side-by-side/narrow-diff-history.png) |
| g1-delete · G1 删除项目 | 已修清单布局和尺寸。确认与拒绝态的截图都等菜单和对话框动画收口。 | [浅色](side-by-side/light-g1-delete.png) · [深色](side-by-side/dark-g1-delete.png) · [窄窗](side-by-side/narrow-g1-delete.png) |
| g5-settings · G5 已归档任务设置 | 已归档任务从设置可达，按项目分组，提供恢复。 | [浅色](side-by-side/light-g5-settings.png) · [深色](side-by-side/dark-g5-settings.png) · [窄窗](side-by-side/narrow-g5-settings.png) |
| g5-readonly · G5 已归档任务只读 | 只读输入禁用，可打开任务关系查看家族，恢复后才可继续编辑。 | [浅色](side-by-side/light-g5-readonly.png) · [深色](side-by-side/dark-g5-readonly.png) · [窄窗](side-by-side/narrow-g5-readonly.png) |

## 仍需核对的差异

- **排队与表单。** 运行时输入框可按能力插话，但已排队条目只有取消，原型和 A75 还要求逐项编辑及立即发送。实现前需要在收据幂等与冻结附件合同下明确编辑后沿用或替换哪一个输入标识。Agent 提问按当前执行器的原生表单输入，选项未统一实现数字键选择；审批面板现有数字键选择和 Enter 确认不受影响。
- **消息标注和原生后台工作。** 切换分隔和交接摘要已有，回答行没有常驻原型那种执行器、来源与模型标记。原生子 Agent 已可查看过程；原型中的通用后台命令与监视计时列表仍缺单独界面和对应的结构化原生事件证据。
- **视觉与夹具。** App 沿用真实项目侧栏、设置页、输入框和档位控件；原型里的状态选择器、演示标题、插件数量以及部分文件路径只供演示。检查了 950 px 页宽的溢出，系统 IME 与更窄窗口未在本轮覆盖。实际收口、真实模型、邮件、网页绑定、权限和系统键盘依正式用例执行。

## 验证产物

受影响测试 395 项通过，7 项跳过。类型检查、开发版构建、文档审计 43 项和验收稿生成一致性均通过。开发版 App 状态对照和两次 G1 专项均正常退出，renderer 无报错。正式 A 层通过数不计入本轮。

- [开发 App CDP 结果](app-verified/app.json) · [原型 CDP 结果](prototype/prototype.json) · [105 组索引](manifest.json) · [构建哈希](build-sha256.txt)
- [G1 浅色专项](g1-verified/light/app-cdp.json) · [G1 深色专项](g1-verified/dark/app-cdp.json)
- [回归](logs/accepted-regression.log) · [类型检查](logs/accepted-typecheck.log) · [构建](logs/accepted-build.log) · [CDP 表达式预检](logs/cdp-preflight.log) · [生成稿比较](logs/generated-docs.log) · [文档审计](document-audit.json)
- [App 场景驱动](state-app-cdp.mjs) · [数据库夹具](state-fixture.mjs) · [原型驱动](prototype-cdp.mjs) · [G1 专项驱动](g1-app-cdp.mjs) · [并排图生成脚本](assemble-comparison.mjs)

首次自测的失败保留在本目录。主要原因是 macOS 临时路径别名、测试夹具缺少原生进程登记、启动清理与测试并跑、合成数据库字段不符，以及主题切换需要等待 renderer 重新读取设置。生产路径别名已修，夹具问题独立修正后复跑。旧 G1 动画帧留在上轮回执，本目录的结果为本轮证据。
