# T088 系统剪贴板准备（仅静态，未执行）

原用例为 I＋S：测试前保存系统剪贴板，系统写合成marker，实际受管原CLI读取marker、写x、系统NSPasteboard核为x，最后完整恢复。真实browser Skill须写明系统剪贴板及仅用户要求时操作。没有真实模型或外部数据发送。

当前只有私有缓存／原P080夹具复用和clipboard-bridge.swift源码，未编译、未访问剪贴板、未启动App／CLI，没有READY或用例结果。P069独占Native时不得执行。

桥保存所有item/type的原始Data，仅在内存与私有0600备份；任何表示不可读、超过预算或并发changeCount变化都先停止，不做首次写。公开资料仅合成marker/x及布尔回执，原剪贴板内容／哈希不入库。恢复按原全部类型与字节比较，只有确认仍是本轮拥有的状态才覆盖；并发用户变化保留私有备份并报告冲突。

仍需：Native租约后在私有Swift缓存编译并先做独立named-pasteboard多格式roundtrip／失败与并发负控；再准备完整原CLI驱动、判定与清场。不能把命名剪贴板预检当系统general结果。

固定6b actions.rs5352–5392实际是navigator.clipboard.readText/writeText，经每页CDP代理执行，读返回{text:…}、写返回{written:…}；当前Electron permissions.ts有真实站点授权门闩。驱动须在保存／设置marker后才发read，记录真实权限提示／焦点需求；不能从E3旧Chrome实验推断最终代理必然成功，不得直接设置允许或用Electron API冒充受管CLI。若须许可，只能按已授权可信UI流程补齐，并先实际前台guard。
