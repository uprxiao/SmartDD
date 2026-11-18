# M14 轮次标题与草稿勘误复验

2026-11-18 · P0.21 原型与隔离开发版 App。左侧为原型，右侧为 App。浅色、深色为 1440 × 900，窄窗为 950 × 780。

| 编号 | App 判据 | 三种视口 |
| --- | --- | --- |
| V18 | 用户消息下方的工作标题显示「你在 N 秒后停止了」。 | [浅色](side-by-side/light-stopped.png) · [深色](side-by-side/dark-stopped.png) · [窄窗](side-by-side/narrow-stopped.png) |
| V26 | 用户消息下方的工作标题显示「正在停止…」，底部可见原等待提示。 | [浅色](side-by-side/light-stopping.png) · [深色](side-by-side/dark-stopping.png) · [窄窗](side-by-side/narrow-stopping.png) |
| V19 | 用户消息下方的工作标题以红色显示「工作 N 秒后失败」，接收未知提示独立显示。 | [浅色](side-by-side/light-failed.png) · [深色](side-by-side/dark-failed.png) · [窄窗](side-by-side/narrow-failed.png) |

三种状态下，每轮只显示一个工作标题。渲染测试覆盖有工作条目和无工作条目两种情况，以及同轮多个工作段由一个标题展开与收起。开发版 CDP 按三种视口检查真实 DOM 顺序、标题数量和失败样式。正在停止的时钟由隔离场景注入。

E2 在需求 R2.0 勘误中登记 ⑦，注明 F14b 及用户 2026-11-18 的确认日期。 [需求勘误](../../里程碑/M14_统一Agent工作区/需求.md#5-修订与决定)

- [开发版截图与断言](app/app.json) · [原型取证](prototype/prototype.json) · [App 驱动](app-cdp.mjs) · [原型驱动](prototype-cdp.mjs) · [CDP 预检](logs/cdp-preflight.log)
- [渲染回归](logs/regression.log) · [类型检查](logs/typecheck.log) · [构建](logs/build.log) · [构建哈希](build-sha256.txt)
- [文档审计](document-audit.json) · [生成稿一致性](logs/generated-docs.log)
