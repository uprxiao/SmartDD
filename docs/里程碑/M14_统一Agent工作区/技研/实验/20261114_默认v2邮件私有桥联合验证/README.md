# 默认 v2 邮件私有桥联合验证

日期：2026-11-14。D04；关联 Q09／Q12／Q41。承接 §4.101，将默认 mail 1.1.0／contractMajor 2、实际 schema-3 快照／运行计划、当前授权、私有 MCP 桥和现有邮件服务接入同一个隔离数据库。最终 attempt-5A33jQ 三项通过；不是产品实现或验收。

## 基线与边界

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`。业务构建 681 项输入，bridge 构建 205 项输入，归档前逐项核对摘要。原 build-bundles 的临时副本只改导入位置和研究桥摘要，采用默认定义，没有开启 retained-v1-test-fixture。实际包注册器验证、安装分发内容。

两个受控 Node 协议宿主分别在同项目的不同 task 运行；实际 MCP bridge 是各宿主的子进程，实际内核身份读取器验证 PID／出生身份和祖先关系。不是 Claude SDK／Codex app-server，也不是同一 task 的 Provider 切换。renderer 与信任谓词、cipher、最终 submit 为夹具；现有邮件冻结、授权、原运行检查和调用账为实际实现。连接测试只向本次自有回环服务器认证，服务器拒绝 DATA；无真实邮件、模型或外部账号。

## 结果

| 检查 | 实际证据 |
| --- | --- |
| V01 默认分发与真实桥 | mail v2 工具和 contractMajor 2 进入实际 run plan；两次桥认证通过内核祖先检查 |
| V02 权限与一次执行 | 通过真实 MCP 创建草稿和发送意图；未授权拒绝。实际 UI 审阅服务批准后，同项目另一 run 可读意图但不能执行；来源 run 受控提交一次，重复调用返回相同 execution |
| V03 当前授权 | 停用邮件后，旧缓存工具调用返回 APP_NOT_ENABLED，下一次 tools/list 为空；持久启动计划保持不变，没有追加 submit |

最终两宿主 exit 0 且内核报告 stopped，两 run stopped、18 份租约 released；SQLite 完整性与外键通过。一次回环认证、一次受控 submit、零 DATA。

## 失败与修正

attempt-x2r9ze 的 V01 通过，V02 驱动误按 v1 返回值读取 `.draft`，实际 MCP 已返回合法 `willyou-app-result-v2`。只修正隔离驱动：校验 schema、contractMajor、status，以及 envelope.operation.id 与 MCP meta 一致，再读取 data；保留原始失败、原调用输出和清理记录。attempt-aPXJDn 在监听阶段 EPERM，零检查／认证／提交；工具批准后执行同一实验。未改产品实现或降低预期。

## 设计结论及剩余项

统一 UI／Driver 必须按声明版本解析业务结果，保留 source、completeness、resources 和 operation 等元数据。不能把 envelope 当旧 data，也不能让 UI 展示层解包后的业务对象充当授权或完整性证明。MCP 声明和持久 run plan 描述可调用能力；执行仍按当前授权核验。缓存工具可见不保证仍可执行，停用不应改写原启动事实。

本轮补默认 v2 与真实私有桥到实际业务的证据；程序化绑定／原生输入来源、同任务跨 Provider 与同库准入／恢复仍未联合。后续复用本批业务链，按 D01 的统一研究 Schema 接入；不重复用协议宿主代替实际 SDK 来源证明。产品用例状态与 Q 宽口径统计不变。

复现：按归档 build.mjs／build-bridge.mjs 固定依赖构建，在 SmartDD cwd 执行临时 build-fixture-bundles.mjs 生成默认研究分发，然后运行 probe.mjs；需要环境允许回环监听。见[结果](result.json)、[来源清单](source-review.json)、[原始归档](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。
