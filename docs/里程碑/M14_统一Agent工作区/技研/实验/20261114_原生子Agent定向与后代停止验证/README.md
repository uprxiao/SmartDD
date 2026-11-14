# 原生子 Agent 定向停止与后代范围

依据 R0.2 的 R05／R06／R11／R12 与 Q29。固定 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1。五项边界检查通过，其中一项专门复现 Codex 单节点 interrupt 不递归的反例。全部模型响应来自本机模拟服务；没有付费模型、外部业务、产品或原型修改。

| 检查 | 已验证结果 |
| --- | --- |
| S01 Claude 定向停止 | 父 result 已成功返回，A／B 两个子模型 HTTP 请求仍等待；stopTask(A) 后收到 A stopped 且其请求关闭；B 未结束，放行其模型响应后 B completed |
| S02 Codex 定向停止 | 父 turn/completed 时 A／B 仍在途；按 A 的真实 threadId＋turnId interrupt，等待 A interrupted 与 HTTP 关闭；B 随后正常 completed |
| S03 Claude 一层后代 | A 创建前台孙任务 C，真实 parent_task_id 指 A、spawn_depth=2；此时 A 在等工具、C 在等模型。stopTask(A) 后 A／C 均报告 stopped，B 未被停止且正常完成 |
| S04 Codex 非递归反例 | agents.max_depth=2，A 创建 C，分别有真实 native thread／turn。只 interrupt(A)，A 已 interrupted，随后才放行 C 的模型响应，C 仍 completed。不能把 A 的终态当整棵子树终态 |
| S05 Codex 显式后代候选 | 对已知 C 发 interrupt 并等原生终态，再 interrupt A；C／A 均 interrupted，B 继续 completed。仅证明这个已知、静止拓扑，不等于解决停止期间新增后代 |

控制日志记录请求、ACK、原生终态和响应放行时的帧序号；等待使用事件／Deferred，不以 sleep 或 ACK 当完成。五份成功实验原生进程均 exit 0。所有 child HTTP 只返回标记文本，无 Shell、文件写、MCP 或业务操作；因此不能证明这些在途活动也已排空。

T3 源码参考：Claude stopSubagent 检查当前 query／原生身份并等待 confirmedOutcome；Codex interrupt 路径枚举 lineage、补处理迟到后代，并另管终端进程。这里只读核对源码，没有运行 T3 适配器，不把源码或本探针升格为 WillYou 已实现的停止服务。

失败记录：初次 Claude 嵌套探针错误等待 A 的第二个模型请求；实际 A 正前台等待 C 工具，所以门闩超时，捕获进程关闭退出 143。改为等待真实 task_started、父完成及 C／B 请求，再按实际工具等待阶段停止，验证通过。未靠增加超时时长或强制改成后台规避差异。

迁移结论：turn_done、节点 terminal、子树 terminal、execution scope drained 是四个不同判断。原生来源节点与宿主委派节点保持不同控制器。停止子树需记录目标／代次和后代关系，逐个取得终态，并处理停止期间新出现后代；未证实排空时保留 stopping／unknown 和写者／业务租约。单节点控制只描述当前节点；不把兄弟一起误停。

仍待验证：更深后代、后台工具、递归期间新建节点、重复停止／迟到旧代事件、宿主退出／恢复、当前业务活动排空、权限及单 Agent 禁用、最终任务树 UI。Q29 保持部分。

复跑依次执行 `node probe.mjs claude`、`node probe.mjs codex`、`node nested.mjs claude`、`node nested.mjs codex`、`node subtree.mjs codex`；需要原固定隔离依赖与 localhost 监听权限。`python3 prepare.py` 核验原始帧的父子关系／终态并生成归档。子请求只在研究门闩中暂停，没有修改执行器内部。

[结果](result.json) · [源码基线](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。
