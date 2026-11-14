# 父 Provider 切换与结果路由：联合验证

2026-11-14；R03／04／05／06／12，Q14／19／24–28／54；技术方案 §7.2.2、验证账 §4.57。仅技术研究；产品、原型不变。

## 验证路径

沿用程序化 task／binding／run 候选以及实际 CapabilityRunRegistry 的私有句柄、活跃上下文和排空检查。同一逻辑父 task 先启动 Codex，再排空切 Claude，再排空切回 Codex 的下一 generation；三次都经过真实初始化。结果服务每次从实际私有 run 取得父归属，不信调用者传入的 task／binding；数据库中的 route 记录本次选中的父 binding。

子结果是预置的两个终态夹具，未运行真实子 Agent。notice 派发和显式停止通知是宿主候选命令，未发送真实 MCP／native 通知。父 busy 对照则使用真实 Codex turn/started、本机服务持有响应、turn/completed；投影仍是实验驱动更新，不是产品事件处理器。

## attempt-6yqTNU：R01–R06

| 检查 | 结果 |
| --- | --- |
| R01 | 真实父 turn 忙时结果保持 pending，领取拒绝；终态后才可领取；父 run 仍 active 时不能切 Provider |
| R02 | 实际 Codex 排空后，未发送 claim 清除旧目标并回 pending，可切 Claude；旧 run／token 再派发被拒绝，两个结果和 delegation 身份不变 |
| R03 | 自动领取与主动完整读取并发进入同一协调事务；仅一个观察 token，旧自动 claim 失效；读取不标 observed，未确认时不再自动领取 |
| R04 | 复制 run 句柄、错误结果摘要拒绝；当前私有 run 用精确 token／revision 确认只记一次，重复返回原确认 |
| R05 | 候选 notice 已 sending，即使 Claude 实际停止，仍阻止切换；恢复为 unknown 也不放行，结果仍未观察 |
| R06 | 用明确的宿主夹具命令停止通知后，结果正文仍未读且保留；切回 Codex generation 2，旧 Claude token 被拒绝；新 run 显式读同一结果并确认 |

最后两个场景验证状态决策，不是 native 通知真实发送／丢失的证明；真实输入确认与崩溃窗口见 §4.56，不能把两个实验相加成完整联合链。停止通知不是接受证据，也不意味着子结果已被父 Agent 理解或任务已完成。

## 进程与补验

首轮 attempt-bnO9J8 六项通过，但 busy 为人工标记；随后增加真实忙碌回合。attempt-rOyZRe 在初始化前因驱动把 JSON 当作 TOML 参数传入 Codex 而退出 code 1，无模型请求；已保留 stderr，不计通过。修正驱动编码后最终六项通过。

三轮共七个捕获原生退出回执；最终 Codex A／A2 code 0、主动取消的 Claude code 143，全部 run stopped、租约 released。仅最终真实忙碌对照发生一次本机合成模型请求，无供应商请求、业务工具或模型费用。最终两个结果各确认一次。

## 设计结论与限制

pending、claimed-but-unsent、sending／unknown 必须分开。切换不改已完成结果的身份；未派发领取可以在原 run 排空并撤销 token 后重路由。已写派发意图不能凭停止推断未发送，必须先对账或由有权限的用户明确停止后续通知，且记录这个决定。

自动通知和主动观察共用结果账，但不能共用“完成”布尔值。读取完整结果只签发当前 run 的 offered token；确认包含 task／binding／run／generation、resultId／revision。UI 查看、自动通知接受、结果读取、观察确认及整个目标结束分别表示。

真实结果响应的序列化／socket 写入、MCP 回包、并发自动派发已越过发送边界、部分分页、子任务执行、模式切换和恢复时继续活着的旧 scope 尚未覆盖。显式确认仍是候选 API，不因为模拟控制流程成功就声明自主协作可靠。完整单任务 A→B→A 的历史上下文交接是另外的验证，本批只核结果路由和所有权。

## 证据

[结果](result.json)、[运行与失败审计](runtime-audit.json)、[源码基线](source-review.json)、[哈希清单](archive-manifest.json)、[驱动／变体／数据库](raw-evidence.tar.gz)。228 文件、15 份 SQLite 完整性／外键通过、504 个唯一构建输入复核。

复跑只在隔离 HOME、临时目录与本机模型服务执行，先 build.mjs／profile-build.mjs，再 probe.mjs；不对真实用户结果执行夹具停止通知命令。
