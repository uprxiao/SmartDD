# Codex 自动审批：模型路由与失败语义

依据 R0.2 R02／R08／R11、Q11／Q12。Codex 0.167.1 的四个 auto_review 分支通过。使用实际 WillYou agentPermission 的 auto 映射，候选 app-server policy 为 workspace-write／on-request／auto_review；仅自定义 localhost Provider、合成凭据与私有文件。没有真实模型判断、付费调用或产品修改。

| 审查响应 | 模型请求（主＋审查） | 原生事件与文件效果 |
| --- | --- | --- |
| 合法 allow | 2＋1 | started→completed approved；decisionSource=agent；文件写入 |
| 合法 deny | 2＋1 | completed denied，保留合成 riskLevel／userAuthorization／rationale；文件不存在 |
| 非法 JSON | 2＋3 | 审查重试后 denied，风险／授权字段 null，原因明确审查格式失败；文件不存在 |
| 审查端点 503 | 2＋12 | 审查重试后 denied，保留服务失败原因；文件不存在 |

每个完成事件的 reviewId／threadId／turnId／targetItemId 与开始事件一致，且 action 含真实拟执行命令／cwd。本轮所有审查和主模型请求都使用 gpt-5.3-codex 并到达相同 localhost 路由；审批模型请求带 JSON Schema，outcome 必填。没有人工 requestApproval RPC。四个父回合均 completed，四个 native 进程均 exit 0；工具拒绝或审查失败不等于整个对话失败。

失败时未改成 never／full，也未转到人工请求或偷偷放行；不能把 native 内部重试次数写成固定跨版本合同或成本上限。provider 配置 request_max_retries=0 并没有使此次审查链只发一次请求。生产须把审查活动、时间预算和原始失败原因纳入诊断，不能用主回合请求数估算整个运行请求数。

源码对照：T3 生成协议包含 item/autoApprovalReview started／completed，并标注 UNSTABLE；targetItemId 可空且可能多次审查指同一工具项。decisionSource=agent，userAuthorization 是审查模型的评级，不是用户回执。本次应用源码搜索未找到这些方法的适配器注册或 UI 消费；这只是静态范围结论，不是 T3 界面实测。WillYou 不可假定统一 UI 会从 T3 自动得到完整自动审查展示。

原始探索失败保留：初次驱动把额外审查请求当作主模型工具结果请求，返回了本机 500，且请求计数上限再次影响主模型，最终父回合 failed。读取真实 request Schema 后区分两类请求；后续四批各自正常收尾。首次失败是研究驱动错误，不能宣称真实服务繁忙或 auto 不支持自定义 Provider。

待验：真实供应商和模型是否支持相应结构化回复／上下文，审查质量与额外 token 计费，受管约束、审查中断与宿主退出、并发／多次同 target 审查、人工切换入口和完整业务联合。普通自动审批不得代替邮件／插件／浏览器的真人审阅证明。

复跑：node probe.mjs codex auto allow／deny／malformed／unavailable，或 allow 后 node batch.mjs；python3 prepare.py 核对事件、模型路由、结果与归档。需要 localhost 监听权限和 native-inputs 中固定依赖。复用的 permission bundle 来自上一批权限实验，源摘要保留。

[结果](result.json) · [源码](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。

## 补充：审查在途取消与同线程下一回合

新增一条真实 native 连续路径通过：第一回合自动审查请求到达本机服务但尚未返回任何响应时，宿主 turn/interrupt；同时等待审查 completed(aborted)、回合 interrupted 和原审查 HTTP 关闭。第一文件未创建，对应 commandExecution 为 declined、processId=null。不能把该 declined 显示成“用户拒绝”：本次来源是回合取消。

同一 native thread／同一 app-server 随后开启第二回合；reviewId、targetItemId、turnId 均为新身份。第二审查 approved，第二文件写入、命令 exitCode=0、回合 completed，第一文件仍不存在。五次本机模型请求，原生进程 exit 0，没有人工审批请求。

旧审查连接已经 destroyed，未尝试在断开的连接上伪造一次成功的迟到批准。这里只证明批准前取消及后续身份隔离，不证明批准已返回／命令已启动后的撤销，不涉及宿主崩溃、业务 MCP、资源租约或真实 UI。复跑 `node probe.mjs`，以 cancel 归档内的脚本为准。

[取消结果](cancel-result.json) · [取消源码基线](cancel-source-review.json) · [取消摘要](cancel-archive-manifest.json) · [取消原始记录](cancel-raw-evidence.tar.gz)。
