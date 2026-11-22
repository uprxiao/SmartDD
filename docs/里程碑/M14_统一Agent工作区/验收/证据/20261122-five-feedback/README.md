# 2026-11-22 日用反馈修复

用例见[本轮复验矩阵](../../测试用例.md#2026-11-22-五项日用反馈复验)。

## 根因证据

| 项目 | 日用证据和复现 |
| --- | --- |
| 首轮目录 | 11:09 日用发送至可见输出约 30.5 秒，`model/list` 三次合计 14.3 秒。旧包 524 用隔离账号和真实界面复现，在原生确认 Sol／中等后仍发出三次目录请求，最后一个 MCP 就绪至开轮 17,785 ms。 |
| 切换执行器 | 11:10 与 11:13，关闭旧执行器前分别等约 5.80 秒与 2.35 秒。探测会重复起登录 Shell 并读版本。本机登录 Shell 单独耗时 1.7–3.7 秒；隔离夹具五轮中位数为 Claude 29 ms、Codex 24 ms，加 300 ms Shell 门闩后为 336／335 ms。日用日志缺少旧包的预检分段。 |
| 文件 | 旧包 532 连续真实单击只保留后一个标签，目录单击走未固定预览。 |
| 插话 | 11:18:36.130 获得原轮次接收回执，11:18:52.366 随后的助手说明出现在插话上方。旧包 533 复现并核实原生只开一轮。 |
| 浏览器 | 初次通用浏览器入口返回宿主不可用。WillYou 的实际浏览器后续在用户批准后成功开页，快照停在 Google 验证页。默认后台开页，需要通过返回的原页标识定位。 |

## T3 Code 参考

- 文件路径复用已有标签，首次打开追加标签。[右侧面板状态](https://github.com/pingdotgg/t3code/blob/fe59fa44d0f12ba1e58b1cccc2c888ac99e743da/apps/web/src/rightPanelStore.ts#L812-L839)
- 点击发送把已排队消息提交给活动运行，Claude 路径等原生接收信号。[队列按钮](https://github.com/pingdotgg/t3code/blob/fe59fa44d0f12ba1e58b1cccc2c888ac99e743da/apps/web/src/components/chat/QueuedRunsControl.tsx#L164-L182) · [Claude 插话](https://github.com/pingdotgg/t3code/blob/fe59fa44d0f12ba1e58b1cccc2c888ac99e743da/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L13454-L13580)
- 模型目录每步受总期限控制。[Codex 目录发现](https://github.com/pingdotgg/t3code/blob/fe59fa44d0f12ba1e58b1cccc2c888ac99e743da/apps/server/src/provider/CodexProvider.ts#L554-L603)

## 最终候选基线

macOS 26.6.1 arm64，WillYou 0.1.6。源码基于 `9f0874a775053bf54703edd2b77c4ac70d7cb684` 与本轮冻结补丁 `cb0f918f5af8d53e74d3ffdd535820a9e3703ba5147a55ecb995963a9c54d7d1`。最终包 `app.asar` SHA-256 为 `d24cea43b5578c92ffe98809cec06b048e104e236cdb975823cd305cc5bd3fdb`。包与完整本机记录位于 `/private/tmp/willyou-m14-stage6.RiIXL3`。主机构建、本机签名验证、原生组件冒烟和 TypeScript 检查通过。软件回归 537 项通过，18 项沿既有条件跳过。原型构建、M9 297 项、M14 31 项通过。

首次沙箱内构建在 LibreOffice 原始签名验证处失败，主机按相同构建流程验证通过。中间包 535 的插话复验发现已取消排队消息仍出现在对话，保留 [失败记录](/private/tmp/willyou-m14-stage6.Wk9T4K/g03/attempt-535/result.json)，最终候选补了排队与已取消状态的时间线过滤。

第二包 531 的切换复验发现 Claude 首次运行改变宿主环境，使第二次预检发起重复登录 Shell。独立加载 SDK 复现了 `NoDefaultCurrentDirectoryInExePath` 的写入，SDK 构造查询时还写入 `CLAUDE_AGENT_SDK_VERSION`。第三包把这些会随 SDK 生命周期变化的值从相应平台的登录 Shell 探测环境排除，实际 PATH 或可执行文件变化仍触发探测。[中间包切换证据](/private/tmp/willyou-m14-stage6.2pbu7Y/g04/attempt-531/result.json)

## 最终包复验

- **A14 首轮目录**。最终包同故障条件下，原生确认 Sol／中等时，从会话就绪到开轮为 257 ms，从点击到开轮为 621 ms。原生确认不足时，只读取一次运行目录，并在时间线说明使用执行器默认，从会话就绪到开轮为 8.415 秒。两场均正常退出。[原生确认](/private/tmp/willyou-m14-stage6.RiIXL3/g04/attempt-533/result.json) · [有界默认回退](/private/tmp/willyou-m14-stage6.RiIXL3/g04/attempt-534/result.json)

- **A15 执行器切换**。第三包 532 跑过双向切换、各自回复、低版本拒绝后旧 Codex 可继续及还原后重试。加入 480 ms 隔离登录 Shell 延迟后，Claude 冷预检 537 ms，热预检 1 ms，Codex 热预检 0 ms。热路径未执行 `--version`。实测确认两项 SDK 元数据在首个 Claude 运行前后发生变化，缓存仍有效。旧进程经核对退出后才提交新选择。App 正常退出，未发现测试进程遗留。[切换结果](/private/tmp/willyou-m14-stage6.RiIXL3/g04/attempt-532/result.json)

- **A73 文件标签**。第三包连续单击三个文件，重选 B，关掉非活动标签，切换网页、终端和差异。覆盖深色窄窗及最后一个文件关掉后回到文件树，App 正常退出。[文件结果](/private/tmp/willyou-m14-stage6.RiIXL3/g03/attempt-534/result.json)
- **A52／A55 Codex 插话**。接收前保留排队行，匹配回执后与前后评论归入原轮次，显示一个活跃计时。错误回执保留未知且不重投。删除后不入对话，普通队列按顺序派发，重新打开任务后顺序正确，App 正常退出。[插话结果](/private/tmp/willyou-m14-stage6.RiIXL3/g03/attempt-535/result.json)

- **A55 无原生插话能力**。插入按钮可见但不可用，删除、自动顺序派发均通过，App 正常退出。Claude Code · DeepSeek 当前使用这一路径。[未支持场景](/private/tmp/willyou-m14-stage6.RiIXL3/g03/attempt-536/result.json)
- **A72 内置浏览器**。真实 Codex 与 WillYou CLI 经回环模型夹具发起操作，确认宿主入口说明进入开发者上下文。审批前没有标签创建。批准后只生成一次，回执携带同一 requestId 和 pageId，点击定位到该页，同时保留原文件标签。回环站点返回模拟验证页，App 正常退出。[浏览器结果](/private/tmp/willyou-m14-stage6.RiIXL3/g04/attempt-537/result.json)

- **A14 P0 已验证缓存复验**。按旧用例保留已验证账号和 Sol／high，阻塞目录刷新后仍在 685 ms 开轮。放行后新目录和刷新时间写盘，事件只记录运行 ID、结果和耗时。维护原账号核验时限，夹具先于 3.5 秒截止给出回执，目录响应仍扣留到本轮回复后。三个 App 和六个原生夹具正常退出。[回归结果](/private/tmp/willyou-m14-stage6.RiIXL3/g04/attempt-536/result.json)

发布范围为 macOS arm64 隔离验收候选。会话开轮数据采自本机夹具，真实日用订阅网络的首段输出时间未测。本轮浏览器验证使用回环站点和确定工具序列，真实 Google 验证及真实在线模型自主选路未计入通过。Claude Code · DeepSeek 当前没有已确认的原生接收验收证据。
