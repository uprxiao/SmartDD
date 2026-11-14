# 浏览器关闭与崩溃边界验证

2026-11-14；技术方案 §9.7.2，验证账 §4.71；R01／08／10，Q37／44。仅隔离研究，产品与共享原型未改。

## 范围与结果

复用[上一批真实页面实验](../20261114_原生浏览器页面与登录态保留验证/README.md)的当前 BrowserService 构建、原生 Electron 和临时 SQLite。此次由研究宿主直接调用现有工作区接口，专查关闭／崩溃边界，不重复 Agent 正常链，也不增加 Agent／模型通过数。

最终 attempt-IC3bRU，四项通过：

| 检查 | 实际观察与约束 |
| --- | --- |
| C01 beforeunload | 真页面已注册返回 false 的处理函数，脚本传入 userGesture=true，Chromium userActivation 为 true；当前 workspace.close 不执行处理函数，不发 will-prevent-unload，最终 destroyed。现有默认关闭不等待网页挽留，不能把上一批的异步销毁误读成默认会被 beforeunload 卡住 |
| C02 来源页关闭 | 通过真实 window.open 创建命名弹窗和 _blank 新标签；同一 session。关闭来源页销毁命名弹窗，新标签保留且 DOM／合成 Cookie 请求可用 |
| C03 renderer 崩溃 | 仅主动崩溃已持有的实验 WebContents；收到 killed/exitCode2。BrowserPage／WebContents 身份仍在。显式重新导航后 DOM 临时变量消失，localStorage／合成 Cookie 保留；真实 CDP Runtime.evaluate 返回2 |
| C04 初始化竞争 | 调现有 createPopup 后立即关闭来源页；本次调度尚未发布子页，初始化内容最终 destroyed，无存活孤儿。未穷举全部并发交错 |

C03 的当前 workspace snapshot 仍为 failure=null、notice=null，源码 workspace 未订阅 render-process-gone。这说明当前投影没有表达本次崩溃，而不是自动恢复已经完成。新统一 UI 需明示浏览器页面健康与恢复状态；不能将逻辑标签存在或 Provider 正常运行显示成网页可操作。实验通过的是显式宿主重新导航＋CDP 核验，未证明自动恢复或完整 helper 操作。

## 设计落点

保留已有业务语义：Provider stop 不关页；显式关闭、来源弹窗级联和 _blank 标签独立生命周期仍由浏览器服务负责。现有 beforeunload 默认跳过，不擅自新增保存确认或阻塞流程。如以后明确改成等待网页卸载，要另外定义批准／取消语义及守卫，不能借 M14 迁移悄悄改行为。

逻辑标签、WebContents、renderer 健康是不同状态。renderer 崩溃不等于 task 结束、Agent 失败或网页已销毁；恢复可保留 partition／持久浏览器状态，但不能承诺保留内存 DOM。关闭时继续以 destroyed 事件核对原生资源结束。UI 增量合同应有健康状态／原因／恢复状态，刷新后经过实际导航和受管通道验证才清除异常，禁止用标题或标签存在作为就绪证据。

## 失败、复跑与限制

首批 attempt-P1B1ef 错把函数作为 executeJavaScript 返回值，IPC 克隆失败；修正研究脚本返回 true 后通过，原始失败保存。两批都完成跟踪页面清理。没有真实外部账号／数据、正式 UI、App 重启恢复、下载、agent-browser helper 交互、跨平台或付费模型。Q37／44 仍部分。

使用实际 Electron 运行 main.mjs；probe 的绝对临时依赖来自上一批归档，source-review 记录逐文件与依赖归档摘要。复跑需先恢复上一批脚本和固定依赖，不能只解压本批就声称可独立运行。所有 userData／sessionData 隔离，Chromium 缓存和依赖不重复归档。

[结果](result.json) · [运行核验](runtime-audit.json) · [源码依据](source-review.json) · [摘要](archive-manifest.json) · [脚本／协议／SQLite](raw-evidence.tar.gz)。本批 38 文件，2 份 SQLite 完整性／外键通过；复用构建的 1190 输入再次核对。
