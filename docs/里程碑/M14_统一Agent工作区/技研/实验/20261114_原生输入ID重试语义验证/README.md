# 原生输入 ID 不等于统一幂等合同

2026-11-14；R03／04／05／06／12，Q14–18／24–28／54–55；技术方案 §6.1、验证账 §4.55。仅独立原生协议实验，没有产品修改、业务工具或真实供应商请求。

## 实验与发现

固定 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1，隔离 HOME 与状态目录。本机 HTTP 服务返回固定文本 SSE，不让模型执行操作。发送完全相同文字与相同 UUID／clientUserMessageId，明确作为故障研究，不采用自动重试策略。

| 执行器 | 结果 |
| --- | --- |
| Codex，attempt-bY8SGV | 同一 thread 顺序两次 turn/start，clientUserMessageId 相同；两次原生 turnId、itemId 不同，均完成，模型服务收到两次请求。相同 clientId 不是这一路径的执行去重键 |
| Claude 初轮，attempt-kofNNM | 第一条结果完成后重送相同 UUID；观察到一次模型请求、无第二份 result，观察截止后正常关闭进程。截止不是第二条已失败／永不执行的证明 |
| Claude 对照，attempt-JDgfxW | 同一会话依次输入原 UUID、重复 UUID、新 UUID。原输入与新 UUID 各有一个 result；总两次模型请求，原生文件只有两个相应 user UUID，通道仍能处理新输入。本轮重复 UUID 没有形成独立结果 |

不将 Claude 的这次表现提升成所有版本、进程重启、未完成输入或队列合并情况下的 exactly-once 保证。该对照也不证明重复输入会重放旧 ACK。确认丢失时盲目重发可能在 Codex 造成重复执行，在 Claude 无法得到预期的新结果，两者都不能由统一层假定成功。

首次 attempt-l0neDl 在监听 127.0.0.1 时被沙箱 EPERM 拒绝，尚无 native 进程或模型请求；取得隔离监听权限后才运行。三次真正原生实验共三个捕获进程，均 code 0；本机模型请求总五次，HTTP 服务均按 finally 关闭。Claude 初轮超时记录保留，没有改标成通过。

## 对统一任务、切换与协作的约束

宿主 commandId／inputId 的幂等、原生输入关联、原生执行去重是三件事。宿主重复命令应读取同一持久回执；原生 clientId／UUID 只按该 driver 已验证语义使用，不能据此重新发起一次执行。原生关联键必须包含 binding／run generation、session／thread，以及可用的 turn／item，而不能只按 clientId 匹配最后一条。

发送前持久记录固定目标、内容摘要、来源和派发尝试。确认丢失、发送中进程退出或接受落库失败保持 unknown；不自动改派其他 Provider、新建 thread、重新注入历史或重送子任务结果。只有能证明未发送／未消费的分支才按原固定请求安全重试；有真实原生证据时另作对账，不把历史回显重新签发为真人 live 来源。

统一 UI 应区分“宿主已接收”“已派发／待确认”“原生接受”“终态”，unknown 有解释和恢复入口；不能显示可无限点击的“重新发送”并暗示无副作用。用户明确选择再次执行时是新的尝试，并显示可能已有执行的事实。这是设计要求，本轮没有实现页面。

T3 当前 Claude adapter 分别读取 prompt echoed UUID 与 command_lifecycle，并按 prompt／steer 身份路由 result；可参考其关联处理。本批没有核验 T3 的完整重发恢复策略，不能据此宣称它已实现这里的持久对账方案。

尚未覆盖真实宿主崩溃、跨进程 resume 后重复、正在执行时的重复／合并、历史注入确认丢失、子结果自动投递与业务副作用。下一步应将这些原生事实用于现有持久账本的恢复验证，不重复跑正常初始化。

## 证据

[运行及三次原生记录审计](runtime-audit.json)、[版本与源码摘要](source-review.json)、[文件哈希](archive-manifest.json)、[驱动、原生线帧与隔离历史](raw-evidence.tar.gz)。58 归档文件。native.mjs 对应 Codex 完成实验，claude-control.mjs 对应三输入对照，初轮脚本在各 attempt 中冻结。较早脚本结果的通用 scope 文案没有描述后加新 UUID 对照，具体覆盖以本说明、sent.jsonl 和实际线帧为准。

仅在新临时目录、隔离 HOME 中复跑，需要本机 loopback 监听权限及对应原生依赖；不要对真实用户输入或业务任务使用重复发送诊断。
