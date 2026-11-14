# 既有业务读模型与邮件回执验证

日期：2026-11-14。D04，关联 Q09／Q41／Q49。承接 §4.99 的候选汇总，进一步核对现有业务服务可复用内容，防止为统一 UI 另造一套丢失业务语义的记录解释器。当前 SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，最终构建 486 条输入摘要已核对。

## 实际执行与边界

实跑连接、选用、SecretStore、草稿／Blob、MailExecutionService、ApplicationActivityService、readDraftSendHistory 和 MailUnknownVerifications。数据均为隔离 SQLite 与公开合成内容。SecretCipher、连接验证、MailSendPolicy 的 actor／用户证据、人工核实上下文／sender 以及 submit 为受控替身；四次 submit 只是函数调用，不连接 SMTP、不读取真实凭据、不发送真实邮件。没有实际 ApplicationExecutionContexts／ToolService 派发、原生 SDK、真人确认或 Electron 页面。

十二项检查通过；最终 attempt-5DLUmw。第一次 attempt-pBAsPF 十项通过后，新增原草稿跨记录核验与两项人工核实检查，原记录保留。第一次 bundle 后被新增导出构建替换，已从原构建脚本和未变化输入重建，并核对 SHA 与当时记录完全一致；reconstruction.json 明确记录该补归档事实，不将重建说成原时点采样。

| 检查 | 实际结论 |
| --- | --- |
| M01 | 实际冻结准备、同请求同 intent；模型 approved=true、无授权执行和错 run 拒绝；用户证明来源为替身 |
| M02 | 同身份密钥轮换使用当前密钥；发送前 grant 已 used，重复 execute 读同一 execution，只有一次受控 submit |
| M03 | failed 却带 accepted 收件人的矛盾回执归为 unknown；复制草稿保留 priorUnknownExecutionIds，新意图须显式核对该来源 |
| M04 | 部分接受时 intent=server-accepted、draft=sent，但 complete=false；实际历史详情保留拒收名单 |
| M05 | 清除选用后重新选择同一连接，旧授权因 binding revision 变化 stale，未提交 |
| M06 | 替身忽略取消并迟到返回成功，实际服务仍保留 unknown，不重发；以 Promise 事件门闩等待，无轮询 |
| M07 | 实际活动服务按 application_activity_subjects 找到无项目连接管理操作；插件历史 connectionId 可在连接已不存在时保留；混合 id／connectionId 损坏拒绝 |
| M08 | 桥与 Data API 共同 operationId 正常展示一次；注入互相矛盾的底层行后，历史投影仍选桥行，因此不能把展示去重作为准入一致性证明；这不是正常路径产生损坏的证明 |
| M09 | 分页 cursor 与筛选绑定；无归属浏览器记录在项目筛选中不出现，缺 browser 表按旧库兼容返回空；完整准入覆盖必须另验 |
| M10 | 历史查询不创建调用／grant；损坏结果拒绝。泛型详情可解析的错 messageId，被实际 readDraftSendHistory 的关联校验拒绝 |
| M11 | 实际人工核实服务追加 sent 观察，原 intent／execution／grant 字节未变，SMTP 仍 unknown；另一窗口矛盾决定拒绝，无发送权限生成 |
| M12 | not-sent 追加观察并复制新草稿，错 frame 拒绝；准备新意图仍携原 unknown 来源且无自动授权／发送 |

最终只读审计：4 个发送 execution、2 份人工观察；无活动发送意图，实际 run 全 stopped、资源租约 released，数据库完整性与外键通过。原始数据包含 M08 合成冲突和 M09 无归属浏览器记录，作为反例保留，不把它们说成生产缺陷或删除后宣称通过。

## 设计决定

统一任务 UI 复用现有活动读模型和业务详情、人工核实服务，保留桥／Data API 共同身份及明确 subject 关联。运行准入单独取得完整覆盖与业务结果解释，不能只看当前页、project 筛选或合并后的状态。

邮件事实至少分为原始传输结果、草稿修订／来源、可验证人工观察、当前许可四部分。部分接受不能显示全部成功；人工 sent 不把 SMTP unknown 改写成原生成功，人工 not-sent 不授权重发。最终汇总摘要也要覆盖人工核实事实及关联来源，不能仅比较四类主表就认为没有变化。

本轮未验证实际 UI／原生来源授权、邮件身份预检和宿主 actor 生命周期联合，业务对象的最小准入范围、所有写入口协调、源覆盖迁移与大库查询也尚未关闭。下一步使用真实上下文与 MailSendDataService／授权服务联合，保留本次既有业务基线。

复现：固定本机依赖具备后运行 `node build.mjs`、`node probe.mjs`，无需网络或账号。见[结果](result.json)、[来源与边界](source-review.json)、[原始证据](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。
