# P012 实际生产类原生集成

基于冻结 002 的真实 `BrowserNetworkPolicy`、`BrowserSiteStates`、`ApplicationError` 与原依赖，运行 Electron 42.11.14 / ABI146、两个私有持久 Session、真实 SQLite、合成 HTTP/HTTPS。生产类是证书及请求回调的唯一所有者；夹具只被动记录证书事件，不回答回调、不安装另一份 onBeforeRequest、不安装 verifyProc。

原始 26 个步骤包含 13 次导航、5 次 fetch，以及实际 state/policy 生命周期操作；逐步请求原文见 `network-comparison-summary.json` 和各 `*.raw.json`。

| 场景 | 实际结果 |
| --- | --- |
| 默认不信任 | ERR_CERT_AUTHORITY_INVALID，HTTPS 服务器零请求 |
| state.trust（仅 UI 授权前置） | 真实 SQLite 写入并被新 state 实例读回；访问成功，写入 Cookie/LS |
| B profile 在 A 已信任时访问 | 不继承 A 例外；证书拒绝、服务器零请求、Cookie 空 |
| state.revoke 后 warm / 关闭连接后 fresh | 均 ERR_BLOCKED_BY_CLIENT、服务器零请求；生产 failed 回调仍给出原证书失败信息 |
| 两层 suspend / 释放一层 | HTTPS、普通 HTTP 顶层导航，以及无 WebContents 的 Session.fetch 均阻断、服务器零请求 |
| 全部释放 | 普通 HTTP 导航和 Session.fetch 恢复；撤销证书的 HTTPS 和同源 renderer fetch 仍阻断 |
| 重新 trust | HTTPS 与 renderer fetch 恢复；带原 Cookie，LS 不丢；实际 certificate getter 返回对应证书状态 |

四次数据快照均保留同一 Secure/HttpOnly Cookie 和 LS 值，只有最初一次 seed，没有为恢复数据而重写。新增窗口在已 suspend 的 Session 中同样被阻断。普通 HTTP 的释放后正例排除了混合内容或 TLS 自身失败造成的假阻断。

首轮独立判定误将原生 `certificate-error` 事件的 `net::ERR_CERT_AUTHORITY_INVALID` 与 `loadURL.error.code` 的无前缀形式混用，出现四条假红。原判定器和首轮结果保留在 `adjudication-001/`；`adjudicator-correction.json` 记录原因和前后 SHA。修正后额外严格检查两载体，并要求生产 failed/getter 错误逐字等于原生事件原文，业务门槛未放宽。没有重跑原生步骤，所有原始文件哈希未变。

最终 19 项独立检查通过。13 个自有 PID、两个监听端口、4 个窗口全部清场；生产证书及 destroyed 监听均回到安装前基线，SQLite 关闭，0600 临时 TLS 私钥删除并独立核不存在。`execution-inputs-final.json` 逐项证明原执行输入和原始数据保持，仅独立判定器按已记录原因修正。

本轮仅提供实际类技术 I 证据。真实 App 的用户风险确认、错误页/红色图标、profile 管理、重启持久化及 Agent 无权放行仍由 T012 A 验收，不据此计整条通过。
