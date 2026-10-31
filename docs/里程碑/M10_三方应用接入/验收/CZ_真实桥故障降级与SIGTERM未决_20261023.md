# CZ：真实桥故障降级与SIGTERM未决

2026-10-23，feature/0.0.2，生产a055ffc2、CR包及真实Codex0.162.1。独立HOME／CODEX_HOME／userData／项目，合成Responses，本地草稿，无外部业务与日常凭据。生产输入未变。

在实际App宿主重启恢复原任务后，只读SQLite查询本次run唯一active桥，用包内process-identity helper核对PID及启动身份完全一致，再对该owned桥注入信号；不操作其他实例或历史未知占用。

SIGTERM首轮：桥诊断断开，但后续工具请求在30秒观察期内未完成。任务清理时原生rollout才产生Transport closed（30.107秒）。本轮不能证明桥已退出，也不能证明错误会自主结束；记录未决故障，需要专门复现桥SIGTERM与stdin／SDK关闭生命周期。原失败不作为通过。

SIGKILL突然崩溃：真实Codex收到Transport closed，仍完成合成回答；原PTY与原生ID不变，新run诊断桥保持断开且successfulToolRequests为0；草稿仍1条、revision不变，无假报恢复或业务重放。最终10项服务检查通过，测试App及监听已清理。第一次SIGKILL运行的断言错误把分段output数组当字符串，原回执实际0.0008秒返回Transport closed；修正为核对结构化回执中的准确错误后复验，原失败保留。

[驱动、三轮结果、日志及哈希](证据/bridge-fault-cz-20261023/manifest.json)。这是T56/T68未验证独立恢复路径的打包服务补验，不包含UI／真实模型或Claude。支持路径恢复调度、SIGTERM等待问题、双项目完整组合仍未闭合，正式15/72（20.83%）。CS全量原进程继续；其输入尚未改，不以该套旧输入结果证明未来修复。
