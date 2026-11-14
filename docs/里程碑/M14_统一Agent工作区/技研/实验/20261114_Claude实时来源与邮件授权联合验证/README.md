# Claude 实时来源与邮件授权联合验证

日期：2026-11-14。D04／D05、Q17／Q41，承接 §4.107。Claude SDK 0.3.321／native 2.1.321 已在同一来源、owner 和实际邮件服务合同下完成四项检查。最终 attempt-5LsY47 通过；未修改产品源码。

## 实验边界

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，实际 bundle 681 项输入、候选 685 项输入；当前源码生成的六个研究变体与 §4.107 的职责相同。默认 v2 分发字节未变。真实 SDK 调用固定随 SDK 分发的原生程序，通过 spawn 回调取得实际 PID／出生身份，私有桥由内核祖先证明鉴别。

SDK initializationResult 与真实 system/init 分开：先以一个内部 bootstrap 回合取得实际 session_id，通过 owned run 写入当前身份，完成后再登记业务来源。bootstrap 没有用户来源 receipt，不代表用户批准；本轮为研究前置，不建议产品为了持久化会话自动发送无意义消息。

真实 NativeUserMessages 文件／inode／header／原始记录证明和实际邮件 tryNative／执行链保持。来源账、程序化运行和注入缝为候选；sender／frame 是模拟受信入口，模型、cipher、SMTP 核验和 submit 都是隔离夹具。没有真实 UI、供应商模型、邮件 DATA 或日常配置访问。

## 四项检查

| 检查 | 结果 |
| --- | --- |
| C01 当前支持门槛 | 当前默认 adapter 对 2.1.321 的 L3 返回 unsupported；仅在之后显式打开研究声明，不能将实验计成已发布支持 |
| C02 内部同文 | 内部委派输入具有原生 user 行和 UUID，实际 send_execute 仍返回 AUTHORIZATION_REQUIRED；零授权来源／提交 |
| C03 真实早期关联 | 同文从模拟受信用户入口提交；首个模型请求到达时仍 dispatching／no-match。随后实际 stream_event/message_start 带单一 user_message_uuid，私有通道核对 session／input；原始提交文本与原生 UUID／文件证明匹配后，现有 tryNative 生成唯一 native-user-message 来源并受控提交一次，重放不重复 |
| C04 续接和退出 | 再次内部自动投递同文不生成真人来源；旧来源保留但不再 live，run 结束后 retained／verify 均失效 |

所有四个业务输入的第一份可用回显均为 stream_event/message_start，早于各自 result；不靠终态倒推发送前已授权。回显没有替代原文证明：宿主保存原始提交文本，按原生 UUID 关联文件中的具体用户行，业务服务仍解析精确草稿修订、连接和政策。

实际默认工具发现也已运行：首轮 mail v2 Schema 被延迟，先通过原生 ToolSearch 选择四个具体工具，再执行业务 MCP。SDK allowedTools 不等同于所有 Schema 初始就在模型请求中；显示已连接也不能说明完整工具定义已交付。

最终一个原生进程、一个私有桥、五个回合（含一个 bootstrap）、十一次本机模型请求；一个 run stopped、25 租约 released，完整性／外键通过。三次回环认证、一次受控 submit、零 DATA。唯一业务授权来源只指向三条同文中的用户输入 UUID；未调用 renderer 的发送审阅／授权，项目发件身份确认仍由模拟管理 UI 完成。

## 保留的失败和恢复

GssJXc 的驱动直接寻找延迟工具，产生本机 500／重试并超时，原生退出 143。其收尾等待 SDK consumer 拒绝后跳过了 cli.exited，原库保留 stopping 与一份租约；进程均已终止。保留原库，在单独副本用实际 registry.recover 核对死亡 owner／进程，得到 stopped、24 租约 released。后续驱动确保 consumer 结果不跳过真实 CLI 退出登记，不放宽产品守卫。

ra2BzQ 已通过 ToolSearch 并创建实际草稿；模型驱动仍按纯 JSON 解析，而 Claude 在 tool_result 尾部附加确切的 total_tokens reminder，导致本机 500。先在保留回包上复现并核验仅剥离这一已知尾部的解析器，未知尾部继续拒绝，再进行最终复验。该解析器只用于本机模拟模型，不作为产品业务协议或授权判断。此失败原生也退出 143，但 run 和租约已正确释放。

三个尝试的三原生／三桥身份重新核验均 stopped；每份库完整性／外键通过。原失败停止状态与副本恢复结果分别保留，不能描述成所有原库都正常结束或全部 exit 0。最初目录尚不存在造成的命令前置拒绝未启动任何原生进程。

## T3 对照与迁移决定

只读核对 T3 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`：ClaudeAdapterV2 的 claudeEchoedPromptUuids 优先取 user_message_uuids，再取单一 UUID，并另处理 prompt lifecycle。SDK 本地类型说明也明确早期 assistant／partial frame 的回显及合并输入列表。WillYou 借用关联机制，业务来源／授权仍由自己的宿主和原服务裁定。

本轮只验证单一消息／turn。批量合并、synthetic prompt 中途折入、子线程、resume_reason、缺回显、其他版本不能套用单 UUID 判据。不要用 SDK yield、队列接受或原生 user 角色代替已观察到的回显与精确文件来源；也不因来源尚未就绪自动重新发送用户输入。

Codex 与 Claude 的单 run 来源→邮件权限已分别取得真实运行证据，仍不代表混合切换／委派、持久输入恢复与实际 UI 同一链已通过。来源能力继续按版本独立声明；业务 fallback 保留明确审阅路径。整体 Q 完整关闭数及正式产品用例不增加。

复现：固定依赖／原生 helper／默认分发就绪后，运行 patch.py、origin-patch.py、build.mjs、build.mjs --candidate、probe.mjs、audit.mjs。setup-claude.py 仅记录从前批生成脚本的过程，不重复用于已生成副本。见[结果](result.json)、[来源和逐次审计](source-review.json)、[完整证据](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。
