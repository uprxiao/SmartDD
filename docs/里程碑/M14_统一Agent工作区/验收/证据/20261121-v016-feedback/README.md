# v0.1.6 使用反馈定向复验

本页所列的本地原件保存在本次复验所在工作区，保存位置及 SHA-256 见阶段验收目录的本地日用复验证据清单。

环境为 macOS arm64，基础提交为 `7a8198b9bb4768605310998a00851ffee4380512`，另带本轮未提交改动。对照包来自已发布的 v0.1.6，ASAR 为 `e8ab479de402cb0e140f4ac79781f5204d480720691287785469bb5e80c9a774`。本轮新包在独立 HOME、userData 和项目目录中通过后台 CDP 测试。用例见 [A1.14](../../测试用例.md)，原验收统计沿用[唯一执行账](../../执行与缺陷记录.md)。

## 实现

- 首页动作和任务页的项目／任务标题及操作进入窗口标题栏。文件面板的最大化以同一已挂载面板替换主体分栏，中央区停止响应输入，保留侧栏及文件缓冲。打开底部终端前还原分栏。
- 手动抽屉立即呈现。原生进程使用单个互动登录 shell，回切通过既有 PTY 输出缓存重放。终端沿用设置页字号和字体，使用 WillYou 的主题色和 Powerline 字符回退。
- Hook 和 MCP 正常生命周期可从“更多 → 运行诊断”查看。已归档任务也可查看。MCP 启动失败、阻断 Hook 和授权告警留在相应时间线；会话归属明确但无法确定回合时，已知失败可在会话级提示。
- 首页与任务页的模型选择靠右。本机订阅的紧凑触发器使用 Codex 名称。模型目录同时公布 GPT-6.2-Sol 和 medium 时首次预选，到真实派发前再核对。已保存或显式选择优先。模型不可用时提示原因并用原生默认。
- T3 Code 参照为 `fe59fa44d0f12ba1e58b1cccc2c888ac99e743da`。核对项目标题栏、终端抽屉、输入区布局和回合时间线的处理。采用 WillYou 的现有组件和运行协议。Powerline 字体来源及许可见仓库 NOTICE。

## 修改前后

| 场景 | 已发布包 | 本轮候选 |
| --- | --- | --- |
| 首页右上角 | 浅色（本地 `before-home-light.png`） | 浅色（本地 `after-home-light.png`） · 深色窄窗（本地 `after-home-dark-narrow.png`） |
| 任务页标题及操作 | 浅色（本地 `before-task-titlebar-light.png`） | 浅色（本地 `after-task-titlebar-light.png`） · 收起侧栏的深色窄窗（本地 `after-task-sidebar-collapsed.png`） |
| 文件面板最大化 | 浅色（本地 `before-panel-maximized-light.png`） · 深色窄窗（本地 `before-panel-maximized-dark-narrow.png`） | 浅色（本地 `after-panel-maximized-light.png`） · 深色窄窗（本地 `after-panel-maximized-dark-narrow.png`） |
| 手动终端 | 旧包首页抽屉被裁出窗口 | Powerline（本地 `after-terminal-powerline.png`） · 窄窗打开终端还原分栏（本地 `after-terminal-restored-dark-narrow.png`） |
| 订阅模型与时间线 | 订阅名称及常规原生通知直接呈现 | 模型菜单（本地 `after-model-menu.png`） · 模型回退（本地 `after-model-fallback.png`） · 时间线（本地 `after-timeline.png`） · 运行诊断（本地 `after-diagnostics.png`） |

## 2026-11-22 定向验证结果

候选 ASAR SHA-256 为 `0245532badcc9315967e980ded6a260445ff3bfffbea8b4f4de708b19f3b27ad`，DMG SHA-256 为 `09dbab239e0132152661f93e5fa9d92c49141efb94be6a45a2dae51bd27ad673`。本地构建使用临时签名，七项安装器与原生组件检查见打包日志。实际复验用 macOS 后台 CDP 操作 App；脚本创建的项目与模型响应均为测试数据。

- A52／A73 定向通过 49 项实包断言。首页窗口栏与导航按钮中心 y 坐标均为 21 px，旧包首页按钮中心为 70 px。1280 px 浅色和 900 px 深色校验文件面板及标题栏，最大化还原保留同一个文件编辑器的缓冲、标签和分栏宽度。打开终端还原分栏，切换任务接回同一 PTY。三个实包测试实例均以退出码 0 退出。 窗口与终端记录（本地 `window-terminal-results.json`） · 旧包对照数据（本地 `published-baseline-results.json`）
- 实际 zsh 使用带 750 ms 延时的隔离配置。旧包首页读取两遍，PTY 约 1.55 秒送出提示符且抽屉未显示。新包首页抽屉约 12 ms 显示，提示符约 0.79 秒出现，只读取一次。任务回切回放约 120 ms，未重新初始化；U+E0B0 确认使用打包的 Powerline 字体。数值反映本轮夹具和本机。
- A14／A59 的两种模型目录各通过 21 项实包断言。正常场景实际首轮发送 `gpt-6.2-sol` 和 `medium`。目录缺少组合的场景有可读提示，首轮改用模拟执行器的原生默认值。两轮中清理常规 Hook 和 MCP、保留失败及权限告警，并检查旧回合通知归属。两种目录均由本地模拟 CLI 提供，未连接用户订阅。 模型与时间线记录（本地 `model-timeline-results.json`）
- 范围测试 456 项通过、7 项跳过。类型检查、原型 M14 30 项测试和构建、文档审计 43 项、生成前后哈希一致性、应用打包与原生冒烟通过。
- 实包迭代修正了首页终端被裁出工作区、浅色终端前景色，以及最大化隐藏期间 xterm 按 2×1 缩放而丢失回显。另在退出前等待原生文件监听解除注册。在本轮候选上用打开文件面板后正常退出的路径复验。
- 额外的 M9 原生监听用例中，批量事件降级提示有过两次超时。单独复跑并交叉使用发布／候选的源码与原生组件，四组均收到了超过 2000 个事件、触发了降级提示，并重新扫出全部 3000 个文件。保留超时记录，未据单次结果推定原因。 交叉复测记录（本地 `file-watcher-results.json`）

## 订阅模型目录与首句延时复验

对照 T3 Code 的本地源码 `fe59fa44`，分别检查目录持久化、菜单读取、选择随消息派发和首句显示。实现依据见[技术方案](../../../技研/技术方案.md)。

本次旧包使用已能分页读出订阅目录的中间构建 `803d6c29`。在同一台 Mac 上，两个打包 App 分别使用全新的隔离目录和同一份 Codex 协议夹具。夹具把活动执行器的目录查询延迟固定为 1500 ms，还可以独立暂停两个必需 MCP 的就绪回执。计时从实际发送按钮按下开始，分别观察 SQLite 受理、普通用户气泡和执行器收到 `turn/start`。模型生成首个回答字的时间不在此项测量范围内。

新版使用同一基础提交，冻结的本次生产输入快照为 `f463612017b271aff772c959fc6654dcb5acae98`。ASAR SHA-256 为 `a72af2651cc4f472bac7b0c180c214263f7dfa55d43b7647376b4eec92c275e2`，macOS arm64 DMG 为 `7820d81f077fd7c77b3a5513708082d583eaea4a7a9acc6c30e9dd580dbdf608`。类型检查与 17 个测试文件的 426 项定向测试通过。覆盖账号及配置变化、首页与任务页选择、运行准备与取消、派发及应用能力启动。打包流程已挂载核验 DMG，并通过 SQLite、PTY、语音桥、文件代理、Office 渲染和文件监听的原生冒烟。

| 一次首发对照 | 旧包 | 新包 |
| --- | ---: | ---: |
| 点击至 SQLite 受理 | 5 ms | 6 ms |
| 点击至普通用户气泡可见 | 2723 ms | 118 ms |
| 点击至 Codex 收到 `turn/start` | 2624 ms | 695 ms |
| 放行必需 MCP 后至 `turn/start` | 1769 ms | 290 ms |

新版在两个必需 MCP 放行前已显示保存的输入。活动执行器核对一次账号，直接使用已验证的模型目录，收到用户所选的 `gpt-6.2-sol` 和 `ultra`。新配置的初始选中项是 Sol 和 `medium`。新旧数据（本地 `catalog-first-send-results.json`） · 启动期间的首句（本地 `catalog-first-message.png`）

新鲜目录重启后，44.4 ms 显示完整菜单，显示前发起的账号和模型查询均为零。将隔离库的记录调为 10 分钟前，再次重启时 48.6 ms 显示旧目录。放行后台刷新之后，打开中的菜单自动出现新增模型，SQLite 同步更新。三次启动均正常退出，26 项实包断言通过。重启后从本地读出的模型与档位（本地 `catalog-fresh-restart.png`）

用另一套全新隔离数据重复以上过程并增加实际点击。旧目录 43.3 ms 显示，账号和目录回执都未放行时，菜单成功将 Sol 的 `ultra` 改为 `high`。刷新新增模型以及关开菜单后，触发器和勾选均保留 `high`。此次新鲜重启打开菜单为 149.1 ms，显示前同样是零次原生查询。首句气泡 137.8 ms，`turn/start` 668 ms。追加运行的 32 项断言通过，三个实例均正常退出。刷新前选择（本地 `catalog-stale-choice.png`） · 新目录及保留的选择（本地 `catalog-stale-refreshed.png`）

最终安装位置为 `/Applications/WillYou.app`。已验证此处的 ASAR 哈希与测试包一致，旧包独立备份。使用此处启动的真实订阅，在首次识别期间看到 9 个临时选项，随后菜单自动出现 GPT-6.2-Sol 和 GPT-6.2-Astra。日用 SQLite 中确认保存了 10 个模型，Sol 的档位为 low、medium、high、xhigh、max、ultra。日用首页先前显示「执行器默认」，按用户已指定的偏好在菜单选中 Sol 与中等，核对输入框显示 `GPT-6.2-Sol · 中等`。此次真实账号验证未发送对话。

## 对话提示、跨执行器切换与供应商完成页

2026-11-22 继续复核。用户在日用安装包中从 Claude／DeepSeek 切回 Codex 后，下一条消息受理至 `turn.started` 实际耗时 26.39 秒，其中 `binding.confirmed` 至 `run.models` 为 15.04 秒。这个时间段是运行重新获取目录，随后才准备历史交接和文件快照。此处来自该回合的持久事件时间，不包含点击本身或线上模型生成首字的耗时。

截图中两项个人 MCP 握手失败与 Codex 配置提示按运行诊断展示。配置告警分别由 `configWarning` 和 `warning` 发出但正文一致，启动会话也可能带来两份同一 MCP 状态。诊断界面按运行合并副本，主时间线保留任务失败和需要用户处理的请求。日常使用的 `config.toml` 仍由用户管理。

DeepSeek 完成页原先只展示实测状态。接入链路对每个兼容协议各验证一个推荐模型。日用供应商记录显示，Flash 在 Pro 后分别通过了 Claude Code 和 Codex 验证。新版完成页可对单格发起同一验证，结果由供应商服务写入已保存记录。T3 Code 固定版本的设置按执行器实例展示能力，使用实例目录和选择，暂无对应的 DeepSeek 双协议完成页可直接沿用。[T3 Code 供应商设置](https://github.com/pingdotgg/t3code/blob/fe59fa44d0f12ba1e58b1cccc2c888ac99e743da/apps/web/src/components/settings/ProviderSettingsPanel.tsx)

最终候选生产快照 `2a39eaa80f92d39c85b2c21bf31ed6a109aad5d5`。ASAR SHA-256 `eeb1bc770637b0d134e253ca0c685a9f6e6887ad4aa9cbfedc01b9a6b3836421`，DMG SHA-256 `a0b588419097cb1acb8cb478b3ce5a0d69452d76e9b8cc4fe9a1938f81d523ac`。类型检查、11 个测试文件 303 项定向测试、原型测试与构建、安装器挂载校验及六项原生冒烟通过。首轮时间线候选曾复现诊断中的重复副本，最终包增加按运行去重并复验。

- 隔离实包时间线场景通过 12 项判据，App 正常退出，无渲染错误。首句后可见执行器准备及思考状态，问候完成后只留用户消息和回答，四个原生通知显示为三个不同诊断并可展开。实际改变一个文件后显示差异卡，点击定位到该文件。阻断错误仍在对话里可查。思考状态（本地 `quiet-timeline-thinking.png`） · 短答（本地 `quiet-timeline-answer.png`） · 运行诊断（本地 `quiet-timeline-diagnostics.png`） · 文件差异（本地 `quiet-timeline-diff.png`）
- 独立实包把目录年龄置为十分钟并挡住后台 `model/list` 的返回。旧目录 119.8 ms 已显示，可以选择 Sol 高档。点击发送至 SQLite 受理 3 ms，同一原生账号 348 ms 认证，461 ms 收到 `turn/start`，使用所选 Sol 和 `high`。隔离服务的回复已可见后才放行目录刷新，717 ms 返回并落库。该试验专门验证应用是否等待目录，实机网络和模型回复时长以真实运行记录为准。目录刷新前已回复（本地 `quiet-timeline-stale-turn.png`）
- 供应商完成页用本机双协议服务，通过 14 项实包断言。接入时只验证推荐的 Pro。点击 Flash 的 Claude Code 格测试成功，Codex 格先由夹具返回 404 后显示「不可用」，点击重测后更新为「可用」。重开确认两列结果入库、推荐模型仍是 Pro。全程访问本机回环服务，未使用日用 Key。自动验证后的未测试状态（本地 `provider-completion-untested.png`） · 完成页测试结果（本地 `provider-completion-tested.png`）
- 已有任务换执行器通过 8 项实包断言。隔离种子设为 Claude／DeepSeek，先点 Codex 图标可预览 Sol／中等，确认后同一任务发给合成 Codex 的参数为 Sol／medium。改为高强度后经 Claude 再切回，菜单预选高。此次从 Claude 种子任务切出，未请求真实 DeepSeek。结合诊断、老化目录和供应商场景的结果汇总（本地 `conversation-feedback-results.json`）。默认组合（本地 `switch-codex-default.png`） · 记住上次的强度（本地 `switch-codex-remembered.png`）

最终包已替换至 `/Applications/WillYou.app` 并启动，安装 ASAR 与最终验收包哈希一致。重开用户反馈的旧任务，确认三轮回答保留，原有零文件卡与 MCP／配置警告退出主时间线。该历史中的一次推理强度确曾未生效，仍以明确的行标题呈现。前一版本已独立备份。
