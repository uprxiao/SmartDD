# A58 无项目网页门槛

2026-11-19 新加坡时间，macOS arm64。冻结候选 `e779d4e1703b2de07789175422ddb3b3ceafe189`，ASAR `7ea76c07ef24e3baa9339e0436d564ca8b7230b8a7ec61357792fbcff55bf988`。测试只使用本轮 App 目录和合成项目。

- 124 实包正对照实际点击有项目的本机 URL，内置浏览器发出请求。CDP Meta 网页和根外文件对照拒绝派发。另一条有效文件的修饰键对照把空的编辑器设置误当作系统没有默认编辑器，实际触发系统默认 TextEdit 打开本轮合成文件。记录 `openExternal` 的真实 `opened` 回执；未发送系统键鼠，也未检查或关闭 TextEdit 窗口。该分支已停止，App 正常退出。[原始结果](attempt-124/result.json) · [外部打开回执复核](verified-124-partial-and-external-receipt.json)
- 126 移除了全部文件及修饰键动作。先真实生成一条带本机链接的任务消息，正常退出。测试夹具只对独立 SQLite 中的这一合成任务清空项目及目录关联，并验证原消息完整。重启 App，通过真实任务搜索打开该任务，实际点击原网页链接；真实入口按无项目规则拒绝、无新增浏览器页、无 HTTP 请求，正对照仍正常。两次 App 正常退出，未产生外部打开调用。[有项目对照](attempt-126/01-linked-positive.png) · [无项目](attempt-126/03-history-no-project-gate.png) · [原始结果](attempt-126/result.json) · [退出与端口](attempt-126/cleanup.json)

[134](../../4da61749f/A58-pdf-authority/README.md) 已补齐 PDF 权限判据。系统原生修饰键与外部接收仍待补验。后台 CDP 的修饰键不计系统层。
