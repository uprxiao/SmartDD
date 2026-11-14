# 原生浏览器页面与登录态保留验证

2026-11-14；技术方案 §9.7.2、验证账 §4.70；R01／02／03／05／08，Q37。仅临时技术研究，产品及共享原型未改。

## 联合链与结果

真实 Electron 42.11.14、当前 BrowserService／WebContentsView／CDP 代理和 browser-prompt preload，接已有程序化 owner 候选。真实 Codex 0.167.1 父、Claude SDK 0.3.321／native 2.1.321 子及同 task 后继 Claude，经原生 shell → 当前受管 CLI → 内核身份网关访问真实页面的标签元数据。模型只使用本机受控回复；批准由受信研究宿主处理。

本机 HTTP 页面设置合成 HttpOnly cookie，页面导航后具有独立 DOM nonce／counter、localStorage。分别在初始、旧父停止、同 task 新 Provider 启动、全部 native 停止后检查：同一个 BrowserPage 对象、pageId、WebContents ID、profileId 和 DOM 状态不变；页面 fetch 实际携带 cookie，服务端返回 LOGIN_OK。不是仅比对标签列表，也不是实际外部账号验证。

最终 attempt-7LK12j 六项通过：

| 检查 | 证据 |
| --- | --- |
| N01 错误进程树 | 有效临时 token＋同一真实 CLI，仍被内核祖先验证拒绝 |
| N02 父子访问 | 各自读取真实 pageId，跨 task 未授权拒绝，分别批准后结果进入下一模型请求 |
| N03 旧父停止 | 两页和模拟登录保留，旧 token 经 CLI 拒绝，子自有 grant 保留 |
| N04 同 task 切 Provider | 新 Claude 看到原父页面，重新申请跨任务权限，未继承旧父 grant |
| N05 原生排空 | 三个 native 与 CLI peer／业务活动结束，两页仍活着，grant 已撤销 |
| P06 显式关页 | 只关闭父页；子页 DOM 与模拟登录仍可用，最终服务关闭后两页 destroyed 事件均到达 |

最后一批 15 次本机模型请求、25 份内核 peer 证明、12 条业务调用、2 个真实页面；10 次 account HTTP 请求带合成 cookie。三个 attempt 共八个 native 均记录退出且最终业务 run／活动／租约已收束；早期缺 preload 和关闭时序断言失败如实归档，不算通过。

## 必须保留的设计语义

页面属于逻辑 task；运行权限属于申请方 run。替换 Provider、撤销 run 或结束原生进程，不应因此销毁逻辑 task 的网页。父子本次属于同一项目，当前默认 profile／partition 相同，登录共享；页面访问仍需 run grant。不能把 run 权限隔离误写成 Cookie 隔离，也不能把其他业务现有的共享登录改掉。

真实 Electron 的 close／dispose 返回不代表 WebContents 已 destroyed。本次 close-return 为 registryRemoved=true、destroyedAtReturn=false；dispose 返回时子页也尚未 destroyed。现有 BrowserPageRegistry 调用 contents.close 后移除 registry，已有单测 fake 同步发 destroyed，无法呈现这个时差。实验只增加事件观察等待，不修改产品实现。迁移实现需区分页面逻辑关闭、业务活动排空、原生页面销毁三个状态；涉及关闭后的资源回收或重用，应在关闭前订阅 destroyed 并核对同一页面身份，超时保留待对账状态，不得将逻辑删除视为已销毁。beforeunload 阻止、崩溃页／弹窗分支仍待相应用例验证。

## 范围与复跑

独立 Electron userData／sessionData、mock keychain、本机模拟页面，未打开日常登录数据。真实 preload 从当前源码构建并保留其兼容检查。Electron ABI146 与 shell Node ABI147 不兼容，SQLite 仅在临时 electron-deps 重建；没有改项目依赖。构建 external electron，无 stub 进入当前依赖图；历史未使用 stub 排除归档。浏览器能力包仍为当前定义重绑研究 runtime，不冒充正式发布包。

运行 main.mjs（实际 Electron main），而不是用普通 node 执行 probe。model/native 脚本、构建输入摘要、preload 源码哈希、运行协议及 SQLite 已归档；二进制／完整依赖／Chromium缓存不归档。关闭检查通过真实 destroyed 事件等待，没有 sleep／轮询，没有修改现有 BrowserService。初始化失败与错误断言均见 startup-notes 和相应 attempt。

未覆盖真实 renderer 审批、新统一 UI、外部网站账号、应用重启后登录保留、跨项目 Cookie 隔离、agent-browser helper 的网页操作／输入／下载、正式安装包或跨平台。Q37 仍为部分证据，不等于完整产品通过。

[结果](result.json) · [运行核验](runtime-audit.json) · [源码依据](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。共 568 文件、15 份 SQLite 完整性／外键通过、1190 构建输入哈希核验。
