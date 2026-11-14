# UI 入口与语音迁移复核

日期：2026-11-14。对应 Q42／Q43／Q48／Q49／Q52。检查现有入口的迁移依赖，并运行实际旧 TasksStore／auto-resume 与 VoiceService／Schema；没有修改或渲染新 UI，没有启动真实 CLI、Typeless、录音、快捷键或业务写入。

## 新发现的入口依赖

[源码清单](entry-audit.json)保存十二个文件及对应行／摘要。除已有中央任务页和标题栏外，以下入口不能遗漏：

- Sidebar TaskStatusTail、LeftSidebar 运行数量、ProjectView 任务状态都依赖 ptyId。新路径不能因没有 PTY 被显示为停止，也不能把连接存活当 Agent 正在工作。
- TaskArchive 以 ptyId／resuming 决定是否确认停止；ResumeAdviceNotice 的加载与停止等待也只看 ptyId。新运行、后台与子任务不能绕过确认或应用变更后的生效提示。
- PluginActionButton 的会话选择只列出运行中的 PTY，并要求当前窗口已有 terminal 映射。只改 ApplicationTerminalButton 仍会让新 SDK 任务从选择列表消失；需一起迁移目标枚举、宿主 prepared action 和投递。
- TasksStore.show 根据 terminal 映射决定 autoResume。新任务复用旧 TaskView 的 ptyId=null 与 resumable，可能重新走 rpc.tasks.open，而不是读取新任务投影。
- VoiceTrigger 仅接受 home／terminal／settings，terminal 还核对 ptyAlive；任务输入框必须有明确的新目标合同，不能伪造 ptyId 或冒用 home。

## 九项实际旧服务检查

| 检查 | 实际结果与边界 |
| --- | --- |
| UIE01 | 将合成 programmatic active 任务错误映射为旧 TaskView，实际 show 调用了一次旧 open RPC；mock 在入口拒绝。证明该迁移接法不成立，不是现有产品已重复启动 CLI |
| UIE02–03 | 旧任务同打开周期只自动恢复一次；归档任务、缺固定能力快照的原生历史不自动恢复。保留旧语义，不将其套到新路径 |
| UIE04 | 实际 store 在打开回执迟到、关闭保存失败时保留任务视图与返回的 PTY 映射，不调用关闭／kill；文件关闭服务是受控失败夹具 |
| UIE05–06 | 新 task-composer origin 被实际 Schema 拒绝；伪装 terminal 而无活 PTY 被实际 VoiceService 拒绝，adapter 未触发 |
| UIE07 | 旧 home 入口成功仅返回 shortcut-sent，无转写文字；adapter 为合成实现，未操作 Typeless |
| UIE08–09 | 在实际 inspect 等待时取消或失去焦点，后续不触发 adapter，返回 TARGET_CHANGED |

[结果](result.json)九项通过，含被拒绝迁移接法的负对照，不是新 UI 或产品验收。[调用轨迹](trace.json)只包含合成任务和 mock 调用。

首次构建缺 mobx 解析路径；复用已有隔离依赖后成功。初稿 probe 还缺一处夹具函数闭括号，Node 在执行前拒绝；修正并通过 node --check 后，唯一执行批次为 attempt-ljtlzE。两项前置问题保留在 [preflight.json](preflight.json)，不伪作业务失败或重复运行真实服务。

## T3 参考与设计结论

本地 T3 Sidebar.logic 的 resolveSidebarThreadStatus 使用运行投影与待审批／用户输入／子请求等状态，不依赖终端存在；threadShell 会处理归档父与子任务的列表关系。借鉴职责分开，不能把其 snooze、guest、PR 或其他产品功能顺带加入 WillYou。

WillYou 应新增有判别字段的 legacy-terminal／programmatic 页面打开路径，中央页、侧栏、搜索／项目列表与菜单共用宿主动作可用性投影。浏览器标签、文件面板和项目资源仍按原 task／project 身份存续；Provider 切换不重建这些业务对象。关闭／归档继续保留文件保存事务与实际运行停止要求，具体活动子树交互按设计评审，不以 ptyId 空值跳过。

新语音入口绑定当前窗口／输入框、task 与草稿／选择代次。编辑草稿不要求 Agent 已启动；焦点、输入目标或选定 Provider 变化时，取消尚未派发的唤起，不自动重试。现有 Typeless 的 shortcut-sent 只表示发出快捷键，不能显示已收到文本或自动提交。全局外部输入快捷键继续保留原语义，不把所有 OS 输入假定为当前任务草稿。实际 OS 焦点／转写／IME 和新接线仍待验证。

本轮新增[原型说明草案](../../../原型/原型说明与变更.md)，明确保留入口与 S01–S09 状态合同；没有修改共享原型代码或生成视觉验收图。业务、原型代码保持不变，产品验收仍 0／54。

复核用 [audit.py](audit.py)，结果见 [audit-result.json](audit-result.json)。重跑先按 build.mjs 准备已有隔离依赖路径，`node build.mjs`、`node --check probe.mjs`、`node probe.mjs`；不能替换 mocks 为真实 IPC／Typeless。换机器需更新路径，audit.py 的批次须指向新结果。
