# R3.4 Office 评论终端投递修复

2026-10-17。专项范围是修复 [Office 动作矩阵](../技研/实验/r34-office-actions-矩阵与验证.md)发现的“评论/Request edits 只有本地列表，未接终端”缺口。沿用 R07.14/R07.19 与 D01：评论只交接到终端输入，CLI 自行按用户指令操作文件；WillYou 不增加 AI 审批、任务完成追踪或保留/还原 CLI 修改状态。

## 本次实现

- [FileOfficePreview](../../../../prototypes/m6-codex/src/FileOfficePreview.jsx) 的“添加到请求”保留评论、页码及所选文字/对象上下文；“插入上下文”通过已有 `onInsertContext(text, metadata)` Promise 管线投递。DOCX 分页选择可携带实际页码/选区，PPT 评论可携带当前对象身份和文字。评论不调用 `onDraft`，不改 Office 内容或 dirty。
- [FileArtifactPreview](../../../../prototypes/m6-codex/src/FileArtifactPreview.jsx) 既有 props 透传无需修改。[FileWorkspace](../../../../prototypes/m6-codex/src/FileWorkspace.jsx) 仅在两处现有调用补 `path={current.path}`，提供当前合成文件的真实路径标识；未改变 PDF 或终端插入实现。此前 30 项交互检查对应的源码已独立保存在[旧版快照](../验收/证据/r34-history/FileWorkspace.before-office-context.jsx)，旧 manifest 不改，本次新增源码哈希另记。
- [独立模型](../../../../prototypes/m6-codex/src/file-office-context-model.mjs) 使用 `queued → inserting → inserted / failed / unknown`。成功只表示插入输入、未追加 Enter；不追踪 CLI 是否读取或执行。失败保留原文并允许显式重试；unknown 保留且不进入后续重试批次。适配器不存在是已知失败；超时、无有效回执或调用抛错无法证明未投递，均记 unknown。
- 单批按顺序投递，遇到首个 failed/unknown 即停止；剩余条目保持 queued。显式重试仅包含 failed/queued，不重发 inserted/unknown。等待时仍可输入/添加新草稿，新评论不自动加入已开始的批次，旧回执不会清掉新输入。
- 终端适配器自身 1.5 秒无回执会返回 unknown；Office 包装沿用同一 1.5 秒等待上限，避免任意宿主 Promise 永久卡住。超时后迟到结果不改变已记录状态。文件 scope、操作编号、实例 generation 和卸载检查共同阻止迟到结果落到另一文件，包括同组件 A→B→A。

没有操作 Codex、用户文件、真实 CLI、宏或模型服务。本轮仍是共享浏览器原型与合成终端；可信文件身份、正式终端 RPC、Office 原件读写与保存兼容性不由此证明。

## 验证

[模型测试](../../../../prototypes/m6-codex/tests/file-office-context-model.test.mjs)新增 **9 条**，与原有 Office 模型 22 条合计 **31/31 通过**（[实际 TAP](../验收/证据/r34-office-context-focused-tests.tap)）：原文/页码/选区、成功不重发、失败显式重试、unknown 保留、迟到回执、在途新增评论、回执分类、Promise 载荷不追加 Enter、超时/异常/缺适配器。主线最终合并验证为 **M9 192/192、parity 5/5、sites 4/4，通过构建**，见[最终测试](../验收/证据/r34-final-prototype-tests.tap)与[构建日志](../验收/证据/r34-final-prototype-build.log)。

独立浏览器 **13/13 通过**，2026-10-17T07:56:17.896Z，Chrome 155.0.8059.80，1280×960，自有临时 profile，沿用 localhost:4176。见[执行脚本](../验收/证据/r34-office-context-browser.mjs)、[实际结果](../验收/证据/r34-office-context-browser-result.json)及[源/证据 manifest](../验收/证据/r34-office-context-manifest.json)。

| 检查 | 实际覆盖 |
| --- | --- |
| OC01–OC05 | 实际 Artifact 透传路径/页码/PPT 对象文字；不追加 Enter；失败保留和显式重试；unknown/无回执/抛错不重发；新草稿保留；混合批次在首个失败停止并仅恢复 eligible 条目 |
| OC06/OC07/OC11 | 同实例换路径、卸载和 A→B→A；旧回执不清掉新文件请求，即使新旧条目的 ID 和操作编号相同 |
| OC08/OC09/OC10 | DOCX legacy 路径与第 3 页；缺适配器明确失败；无未处理页面错误与外联 |
| OC12 | 实际等待约 1545ms 后 unknown，符合 1.5 秒计时器及浏览器调度；迟到 success 不改状态 |
| OC13 | 真实共享原型 `?preview=m9` 打开 `docs/发布演示.pptx`，从 Office 经 FileWorkspace/sendToTerminal 到 App 演示终端，输入含真实 fixture 路径与评论，未回车、无 CLI 审阅 |

截图：[混合批次](../验收/证据/r34-office-context-mixed-batch.png)、[DOCX 上下文](../验收/证据/r34-office-context-docx-context.png)、[共享工作区终端](../验收/证据/r34-office-context-workspace-terminal.png)。初轮 12 项使用旧 2 秒包装等待值，保留为 `r34-office-context-browser-initial-12.*` 历史，不当作当前 1.5 秒实现结果。

本轮不改正式 425 条验收用例及其状态，不重跑或覆盖已有 Office 引擎实验。动作矩阵仅追加这次修复链接；修改前原文和 manifest 已保存在其 history 目录，原引擎源码/结果哈希不变。

## 保留边界

- 评论状态保存在当前原型实例内，没有新增跨崩溃/跨重启的评论持久化承诺。
- unknown 后需要用户先检查终端；原型没有“自动判定 CLI 已处理”或自动重发。
- 原始 Office 格式适配、被引用 sheet 删除的 LibreOffice 自回读缺陷、完整 Office 键盘/字体/布局及安装包验收仍按原矩阵继续；此修复仅关闭评论未接通原型投递的问题。
