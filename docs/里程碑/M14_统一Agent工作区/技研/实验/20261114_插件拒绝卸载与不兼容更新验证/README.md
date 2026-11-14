# 插件拒绝、卸载与不兼容更新

2026-11-14；技术方案 §9.6.1、验证账 §4.67；R02／05／06／08／10，Q09／27／28／40／41。沿用 §4.66 的真实 Codex 0.167.1 父运行、Claude SDK 0.3.321／native 2.1.321 子运行、现有私有 MCP／ToolService／PluginHost 与沙箱插件。模型只用本机端点，插件只写临时 privateData；产品与共享原型未改。

## 三个分支，各四项检查通过

每个分支先让父子同时等待插件写审批，再启动生命周期变更；完成子调用并停止子运行，确认父审批及变更等待仍保留；处理父审批后才允许变更收口；同一父原生 thread 再发一轮，核对最新工具结果和实际调用账；最后释放全部自有运行资源。

| 分支 | 原待办与变更 | 同一父会话下一轮 | 实际写入 |
| --- | --- | --- | --- |
| deny | 子允许、父拒绝；父 PERMISSION_DENIED／failed／not-started，兼容更新随后完成 | 新包需要全新审批，允许后成功；原拒绝回执不能重用 | 子旧版一次、父新版一次 |
| uninstall | 选择保留数据卸载；两条审批都允许，但最终执行守卫返回 NOT_FOUND／failed／not-started；零写入后卸载提交 | NOT_FOUND，attemptCount=0；没有新审批或业务调用账 | 0 |
| incompatible | 两条旧审批允许并按旧合同写入，随后新包将 capability semantics 从 write 改为 read | CONFIG_INCOMPATIBLE；既有启动范围拒绝变化，没有新增审批、调用账或写入 | 两次旧版写，新版 0 |

每个最终分支六次本机模型请求，Codex 只创建一个 thread、两个 turn 使用相同 threadId；原生回合终态成功表示错误已作为工具结果进入模型并正常结束，不表示被拒绝的业务执行成功。三条路径均在最终快照核验运行／桥退出、run 租约释放和当前插件租约关闭，无真实秘密读取。

## 关键设计结论

审批决定、业务执行事实、插件生命周期分别记录。特别是卸载期间 allowed 可以对应 failed／not-started；统一 UI 不能仅凭审批允许显示“操作成功”，不能自动重放该操作，也不能迁移旧批准到新包／新 run。现有 PluginSessionTools 在审批后再次调用 authorize／invocation.assertActive，是迁移必须保留的最终守卫。

兼容与不兼容更新不能一刀切。兼容分支可在同一原生会话继续；实际能力 permission／semantics／slots 等发生启动合同不接受的变化时，保留启动来源、拒绝旧运行调用并给出重启会话提示。本批只实测 semantics 变化，其他字段不能据此逐项宣称通过。

## 保留的实验失败

首次 uninstall（attempt-uninstall-Mx1S5V）前两项已通过；后续调用实际返回 NOT_FOUND，实验误期望 APP_NOT_ENABLED，使本机模型端点返回 500、父回合失败。原始请求／失败／最终清理均保留。修正实验错误码预期，改成只检查最新工具结果，复验通过；没有修改产品行为。deny 的旧驱动也离线复核最新工具结果，避免从历史内容误判。

最终批次：attempt-deny-pknWiY, attempt-uninstall-ChcUox, attempt-incompatible-ThjHSo。含失败共四批、八个真实原生进程、24 次本机模型请求；各批最终所有记录的自有运行资源均结束。旧版插件 lease 行可能随安装清理删除，不用最终行数倒推历史总进程数。

## 边界与证据

审批为研究私有窗口 facade；候选程序化启动／委派没有接入产品。没有真实 renderer／IPC、外部业务、共享 SVN 写入、更新／卸载中宿主崩溃、审批超时、删除私有数据卸载、其他不兼容字段或跨平台证据。并发的是待审批调用，实际写函数按实验顺序执行。

[结果](result.json)、[逐分支运行审计与最新工具结果](runtime-audit.json)、[源码核对](source-review.json)、[归档摘要](archive-manifest.json)、[脚本／协议／数据库](raw-evidence.tar.gz)。397 文件、19 份 SQLite 完整性与外键通过、853 构建输入核验。运行需要固定依赖与原生版本，仅使用临时 HOME 与本机模型端点。
