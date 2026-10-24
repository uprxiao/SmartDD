# IR：同 HOME 双 App 目录占用保留

依据 R1.6＋§12.21，补 T54 步骤2及 T55 跨 store 同名保护。IJ实际包、macOS arm64、真实Codex0.162.1；两个独立App PID和userData，使用同一私有HOME/CODEX_HOME。合成模型，不使用日常凭据，生产输入未变。

A已建立共享投影并运行邮件会话。B另建项目及AI配置，选邮件并通过生产tasks.create启动真实Codex。B明确诊断AGENT_CAPABILITY_NAME_CONFLICT，原生请求无应用mcp__wy_命名空间，普通响应成功。A的共享Skill文件集合/hash、catalog全部字节及原消费者记录保持；A原生ID/PTY、快照和bridge仍在。关闭B后再次核对A消费者与共享目录仍完整。

本轮10组检查通过，exit0，两App均清理。首轮上述核心检查已通过，但收尾沿用单实例原生提示计数1，实际双实例Codex自行写为2，导致驱动断言失败。复验精确核对业务前缀与唯一提示增量2通过；不宣称整个profile字节不变，主config字节未变。原失败保留。

[红绿结果、双PID/目录/消费者证据及驱动](证据/two-app-ir-20261023/manifest.json)。本轮证明同名不同store保护与普通原生工作继续，不证明B能接管A所有的投影；未测试跨store新增独立名称、主动取消、进程孤儿和Claude。非GUI输入验收。T54/T55仍部分执行，正式16/72。
