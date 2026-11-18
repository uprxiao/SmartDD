# M14 分类修复复核 D1–D4

2026-11-18 · P0.21 原型与隔离开发版 App。并排图左侧是原型，右侧是 App。浅色与深色为 1440 × 900，窄窗为 950 × 780。一轮完成状态在两边实际展开工作过程后取证。

| 状态 | 判据 | 并排图 |
| --- | --- | --- |
| running | 同一行显示「读取了 3 个文件，运行了 1 条命令」，过程说明以正文插在工具段之间。 | [浅色](side-by-side/light-running.png) · [深色](side-by-side/dark-running.png) · [窄窗](side-by-side/narrow-running.png) |
| approval | 请求面板保留，已完成工具依据相邻顺序合并，过程说明独立显示。 | [浅色](side-by-side/light-approval.png) · [深色](side-by-side/dark-approval.png) · [窄窗](side-by-side/narrow-approval.png) |
| stopping | 正在停止的轮首和强制停止提示与工作过程同屏。计时采用场景夹具。 | [浅色](side-by-side/light-stopping.png) · [深色](side-by-side/dark-stopping.png) · [窄窗](side-by-side/narrow-stopping.png) |
| done | 展开回合后可核对工具分组和过程正文，最终回答继续独立显示。 | [浅色](side-by-side/light-done.png) · [深色](side-by-side/dark-done.png) · [窄窗](side-by-side/narrow-done.png) |
| failed | 失败轮首、错误图标和详情入口可见，接收未知有独立提示且不自动重发。取证时点击了详情入口并核对正文。 | [浅色](side-by-side/light-failed.png) · [深色](side-by-side/dark-failed.png) · [窄窗](side-by-side/narrow-failed.png) |

- **D1 表格。** MarkdownIt 解析出三张表，表头和每行都是五列，分别有 4、35、15 个数据行。Chrome 的预览逐一核对了三张表的表头和首行。 [完整预览](markdown-preview.html) · [三张表节选截图](markdown-preview.png) · [解析日志](logs/markdown-preview.log)
- **D2 标注。** F14 按确认未发送消息与草稿冲突拆开。前者引用 V35 的图，后者链接本轮草稿取证。 [差异清单](../evidence-20261118-claude-phase1-5-s1-s2/原型状态差异清单.md)
- **D3 工作过程。** 对照本地 T3 Code `fe59fa44d0` 的 `MessagesTimeline.logic.ts` 和 `work-log/presentation.ts`。连续成功的工具先按时序聚合，再按动作计数。展开显示实际各项；过程正文、进行中和失败的工具会断开该组。
- **D4 草稿。** 用真实的草稿保存 IPC 写入另一修订，再在 App 用实际输入触发冲突。第一次点击「用另一份」保留当前草稿并打开确认框，第二次确认后，读取修订 1 并替换。本轮渲染用例另外覆盖取消替换、附件、选择保留当前再次冲突，以及确认后另一份又变化时保留本地。 [冲突](app/light-draft-conflict.png) · [再次确认](app/light-draft-confirmation.png)

相关渲染端回归 66 项通过。类型检查、开发构建、文档审计及生成一致性通过。首轮渲染测试暴露了测试匹配器和冲突夹具串扰，已修正并整组复跑。验证在隔离 App 内完成，正常退出且无渲染报错。F08 的重新核对和连接重试仍推迟，本轮证据按开发自查归档。

- [回归](logs/regression.log) · [类型检查](logs/typecheck.log) · [构建](logs/build.log) · [构建哈希](build-sha256.txt)
- [App 证据](app/app.json) · [App 驱动](app-cdp.mjs) · [原型证据](prototype/prototype.json) · [原型驱动](prototype-cdp.mjs) · [CDP 预检](logs/cdp-preflight.log)
- [文档审计](document-audit.json) · [生成稿对比](logs/generated-docs.log)
