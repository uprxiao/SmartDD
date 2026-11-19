# A30 三类目录实包验收

2026-11-19（UTC+08:00），macOS arm64，候选源提交 `68fbd2c79ea6ab0ea23d12fe4609f05f40dafa16`，ASAR SHA-256 `53e7a603168936d8abd8420de2a5a82372c9656f964979cfa7fcce05b03ae396`。使用实际 Codex 与 Claude 原生链路，模型为各独立实例的本机合成端点。所有测试数据为合成数据。

| 判据 | 证据 |
| --- | --- |
| Git、SVN、普通目录逐一真实发送及 Codex→Claude→Codex，三类均恢复原 Codex 原生会话 | [不挂观察器对照](attempt-055/result.json)、[观察复验](attempt-058/result.json)、[Git](attempt-058/git-executor-switch.png)、[SVN](attempt-058/svn-executor-switch.png)、[普通目录](attempt-058/plain-executor-switch.png) |
| 三类目录均可运行两个无委派关系的独立任务。首个回合仍运行时第二个作答，两个原生运行都保留，目录写入队列为空 | [逐目录的实包记录](attempt-056/result.json) |
| 每类目录的只读子任务在父回合活动时执行，写入子任务等父回合交接后才开始，在原目录实际写入；未创建工作副本或提交 Git HEAD | [A 层](attempt-057/result.json)、[SVN 写入](attempt-057/svn-shared-writer-completed.png)、[U／I](software.log) |
| 版本化 SVN 工作副本内嵌独立 Git。明确申请工作副本仍按 SVN 拒绝，正常 SVN 差异走私有影子库 | [嵌套身份及实际委派](attempt-057/result.json) |
| 产品主进程观察、实际差异工作线程启动和进度、启动与切换只读数据库核对、96 个样本哈希及复制检查。不做全量复制或全盘 hash；实际发送才触发预期差异捕获 | [切换原始追踪](attempt-058/main-io.jsonl)、[委派原始追踪](attempt-057/main-io.jsonl)、[观察判据及正控](attempt-058/result.json) |

054 尝试在渲染入口前接入观察器，页面未就绪，未进入业务场景，保留[原始失败](attempt-054/result.json)。055 对照通过，057／058 改为页面就绪后观察并有明确文件操作正控。页就绪前用零差异行、样本未变和无复制验证，观察器范围为 App 主进程及差异 worker 的启动与进度，外部原生进程未做 OS 级全量文件调用跟踪。055–058 的隔离 App 均退出 0，renderer 无错误。
