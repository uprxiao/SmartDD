# T088 系统剪贴板准备（仅静态，未执行）

原用例为 I＋S：测试前保存系统剪贴板，系统写合成marker，实际受管原CLI读取marker、写x、系统NSPasteboard核为x，最后完整恢复。真实browser Skill须写明系统剪贴板及仅用户要求时操作。没有真实模型或外部数据发送。

当前只有私有缓存／原P080夹具复用和clipboard-bridge.swift源码，未编译、未访问剪贴板、未启动App／CLI，没有READY或用例结果。P069独占Native时不得执行。

桥保存所有item/type的原始Data，仅在内存与私有0600备份；任何表示不可读、超过预算或并发changeCount变化都先停止，不做首次写。公开资料仅合成marker/x及布尔回执，原剪贴板内容／哈希不入库。恢复按原全部类型与字节比较，只有确认仍是本轮拥有的状态才覆盖；并发用户变化保留私有备份并报告冲突。

仍需：Native租约后在私有Swift缓存编译并先做独立named-pasteboard多格式roundtrip／失败与并发负控；再准备完整原CLI驱动、判定与清场。不能把命名剪贴板预检当系统general结果。

固定6b actions.rs5352–5392实际是navigator.clipboard.readText/writeText，经每页CDP代理执行，读返回{text:…}、写返回{written:…}；当前Electron permissions.ts有真实站点授权门闩。驱动须在保存／设置marker后才发read，记录真实权限提示／焦点需求；不能从E3旧Chrome实验推断最终代理必然成功，不得直接设置允许或用Electron API冒充受管CLI。若须许可，只能按已授权可信UI流程补齐，并先实际前台guard。

## 接续静态准备（2026-11-05，未执行）

已在原私有根补齐 run.mjs、独立 judge.mjs、cleanup.mjs、bridge.mjs、实际命令 schema 检查及 JS／纯数据预检。旧 Swift 初稿、未过滤 receiver、第一版隐私控制和 handoff-static-frozen.json 均原样保留；后者描述当时冻结位置，不是本次状态。

execution-ready.json 只表示可以在协调者授予 Native/UI 资源后尝试门槛。Swift **尚未编译或类型检查**，8 项独立 named pasteboard 安全测试**尚未运行**，general 剪贴板**未访问**，App/CLI/OS/监听均未启动。静态绿只覆盖语法、命令参数、准确响应层级、隐私过滤和路径约束，不计 T088 的 I 或 S。

正式驱动顺序：真实 Swift 编译 → 唯一 named pasteboard 的多 item/类型/原始字节/顺序恢复、不可读、预算、首次写前并发、备份碰撞、恢复冲突、混合 x 和 CLI 写前 ownership 8 项 → 实际 App/受管 CLI 身份/create/snapshot 前置 → 一次 setup reload → 120 秒内真实初始前台三条件稳定至少 1 秒 → onceguard → 真实 UI 展示测试页 → general 全格式私有备份及 marker → 原 CLI 读 marker → 核 marker ownership → 原 CLI 写 x → OS general 核纯 x → 原 CLI 读回 x → 停止 App 与所有 CLI → 恢复并逐 item/type/Data/顺序比较 → 正常退出桥。

实际在途 clipboard CLI 与可信权限 UI 分开调度；有提示时只在本轮 focus guard 下真实点击一次“允许”，继续等同一个原调用，不直接保存权限、不重发。原剪贴板或未知 CLI 值只进 RAM 或 runtime-001 内 0600 私有备份/输出；任何 public manifest 均排除 runtime，连原数据衍生哈希也不生成。测试期间不截图终端或意外内容，错误完整文本同样只留私有。

NSPasteboard 没有原子 compare-and-swap。即时 changeCount＋全部字节核对能拒绝已观察到的并发变化，无法消除最后检查到 clear/write 之间的竞态；执行期间避免其他复制操作是前提。检测到新用户状态、混合格式 x、未停止的 CLI 或未知写结果，恢复不覆盖新状态，保留私有恢复材料，整条不通过。未知 EOF 不自动恢复到仍可能有在途写的 App 中。

另提供 `--native-gates-only` 可在未来独占 Native 租约下只编译和运行 named 安全门槛，完全不启动 App/general，不需用户前台；仅工程前置结果。该参数也消费新 runtime，后续完整 general 必须用新 attempt，不允许在同一根重放。
