# 混合 Provider 子提问与关闭语义验证

日期：2026-11-14。关联 D02／D06、Q11／26／27／28。真实 Claude SDK 0.3.321／native 2.1.321 与 Codex app-server 0.167.1 接入同一当前会话／运行注册器及 SQLite。父子关系与回应账为临时候选，模型及答案为本机合成内容。

## 八项检查

| 检查 | 实际结果 |
| --- | --- |
| J01 相同问题 | Claude 与 Codex 同时提出相同 message／schema；跨子／父作用域回答拒绝，活跃 run 不准提前退役 |
| J02 父指针变化 | 修改候选父 binding 不改变子问题归属；未执行真实父 Provider 切换 |
| J03 停止 Claude | A1 取消后旧回答拒绝，Codex B1 正常收到 B_ONLY，重复决定不重复发送 |
| J07 停止 Codex | B2 中断后请求收到真实 resolved，但没有用户答案且取消意图为 1；Claude A2 仍在等待用户 |
| J04 Claude 续接 | A2 实际 SDK resume 同一 native session，新 run／generation 拒绝 A1 的旧回答，当前答案抵达 MCP |
| J05 正常／取消 | B1 无取消意图、有已提交答案及精确 Codex 关闭证据；复制句柄拒绝，重复退役幂等，晚到回答拒绝 |
| J06 退役原子性 | Claude A2 已退出后注入活性更新失败，退役证据与状态整体回滚；重试不重发答案 |
| J08 Codex 续接 | B3 实际 thread/resume 原 native thread，连接／run 已换，拒绝 B2 旧回答；MCP 收到 B_NEXT，正常关闭 |

八项通过，八个本机合成模型请求、五个原生进程全部退出。A1 主动中断退出 1，其余退出 0；所有实际 run stopped、租约 released，SQLite 外键及完整性通过。模型请求及业务外部写入均未使用真实服务。

## 关键发现

Codex B1／B2／B3 的 native thread 相同，原生请求 ID 三次都是数字 0；仍须按连接、run、generation 和任务区分，不能依赖 ID 单独去重，不能用真值判断丢弃 0。真实 serverRequest/resolved 经当前连接句柄验证 thread／typed requestId 后入关闭账；本轮正常回答和取消都有 resolved，不能将其当作批准或业务成功。

Claude 使用 SDK callback requestId 回复，没有伪造 Codex 关闭帧。正常运行结束后候选保存 runtime-ended 并使旧入口 expired、cancel_requested=0；主动取消为 1。Codex 的精确 closed 与 Claude 的已退役 expired 可在统一 UI 中都有“无需继续回答”的含义，底层原因与投递证据仍须保留。

结果 JSON 中继承的 no native-close claim 描述只适用于 Claude 的运行退役；本轮 Codex 有实际关闭帧。J05 的 retirementNotNativeClose 表示退役动作自身不创造原生关闭证明，Codex 证明来自独立 journal／apply。原始输出保留，范围在此明确。

## 与 T3 对照及边界

本地 T3 的 ClaudeAdapterV2.onElicitation 使用 SDK callback ID 建立 runtime request，并将 abort 与待决回应清理关联；CodexAdapterV2 在活动 turn 上处理其能回答的 MCP elicitation。参考“各适配器保留协议差异、上层统一请求”的分层，不照抄其审批卡能力为 WillYou 任意表单已支持。此次仅阅读 T3 源码，没有运行 T3 适配器测试。

本轮使用实际注册器，但额外 adapter 资源及选择规则为明确夹具；父子关系不是完整 delegate／outbox 创建服务，尚无实际父切换、真实 UI／业务审批、供应商模型行为或宿主崩溃。上一轮原生全退出后的恢复证据不能扩展成原生仍活跃的恢复。下一步验证宿主死亡而原生进程仍存活／状态未知时，问题入口失效与运行租约保留能否共同成立。

## 复现

固定依赖及本机监听权限具备时执行 `node build.mjs`、`node probe.mjs`。归档包含驱动、夹具、实际构建、379 条输入摘要、五个原生过程／MCP 结果、关闭通知及最终数据库。T3 两个参考文件的版本和摘要记录在来源文件中。

[结果](result.json) · [来源](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。
