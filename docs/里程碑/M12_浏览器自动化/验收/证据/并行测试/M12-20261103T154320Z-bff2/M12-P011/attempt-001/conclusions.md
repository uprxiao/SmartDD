# P011 证书撤销技术实验

Electron 42.11.14 / Chromium 148、ABI146；固定源码、实际二进制和脚本哈希见 `source-provenance.json`、`static-preflight.json`、`source-hash-final.json`。六组使用独立私有持久 Session，同一个合成自签 HTTPS 站点；仅将 `m12-cert.test` 精确映射到本次 127.0.0.1 监听。无日常 profile、外部站点、TLS 忽略参数或 preload。

无例外基准被 `ERR_CERT_AUTHORITY_INVALID` 拒绝，服务器未收到该导航请求。每组允许后先实际写入 Secure/HttpOnly Cookie 和 localStorage，再撤销；失败后从另一个仍在该源的已加载只读窗口取 LS，从真实 Session 取 Cookie，不重新放行或重新写入来证明数据保持。

| 机制 | 撤销后的暖连接访问 | 明确关闭连接后的新访问 | Cookie / LS |
| --- | --- | --- | --- |
| 动态删除 verifyProc 使用的 allow 集合 | 仍加载，服务器收到 1 请求 | 本臂未追加 | 保留 |
| 删除 allow 后 closeAllConnections | — | 仍加载，新 TLS 连接收到 1 请求 | 保留 |
| 删除 allow 后安装新 verifyProc | 仍加载，服务器收到 1 请求 | 本臂未追加 | 保留 |
| 删除 allow、close 后安装新 verifyProc | — | 仍加载，新 TLS 连接收到 1 请求 | 保留 |
| certificate-error 动态回调 | 仍加载，服务器收到 1 请求 | 重新产生证书错误回调并拒绝，服务器 0 请求 | 保留 |
| onBeforeRequest gate ＋ certificate-error | 当场取消，服务器 0 请求 | 仍取消，服务器 0 请求 | 保留 |

`comparison-summary.json` 保存逐臂导航、服务器原请求、TLS connectionId、Cookie 请求头及回调。四种 verifyProc 路径均只在初次允许时回调一次；重装第二代回调后没有再次调用。close 两臂明确从连接 2 到 3、5 到 6，仍携带合成登录 Cookie 到达服务端，排除了仅复用旧连接的解释。结果符合官方 [42.11.14 Session 契约](https://raw.githubusercontent.com/electron/electron/v42.11.14/docs/api/session.md)关于验证结果由网络服务缓存的说明，不能由重装 API 名称推定清除。

事件回调单独路径并非全面无效：关连接后的新请求确实拒绝；但暖连接上的撤销未立即阻断。若产品选择依赖关连接，必须把关闭完成纳入撤销提交边界并另核请求并发。本实验建议采用能覆盖两种连接状态的请求 gate；没有新增 clearAuthCache 或其他差异实验。

Orca 固定提交的 request guard 保留已接受的证书身份，在授权移除后仍能拦截缓存路径，并把 main-frame 拦截恢复成证书失败状态。WillYou 实现时应同样保留本 Session 已知不受信任主机/身份的状态，不能删掉 allow 后连 gate 所需的已知状态一起忘掉；普通有效 HTTPS 不应被这个标记误拦。R01.5 的例外仍按主机及 profile，夹具的精确指纹和端口限制只是本次隔离边界，不擅自改业务授权范围。

gate 的底层错误为 `ERR_BLOCKED_BY_CLIENT`；产品还需关联原证书失败信息，不能让它退化成通用加载失败。证书 gate、Cookie 导入隔离及其他请求策略必须共用一个 Session 分发器；[WebRequest 契约](https://www.electronjs.org/docs/latest/api/web-request)的单监听限制见 `official-contracts.md`。本次实验结束将独占监听恢复 null，不意味着生产中可直接覆盖其他保护。

18 项独立检查全部通过。所有 20 个自有 PID、唯一 HTTPS 端口及 13 个窗口已清场；六组监听恢复，0600 临时 TLS 私钥已删除并独立核不存在。此结论仅是技术 I 前置；用户风险点击、红色图标、profile 管理、重启持久化、真实撤销交互及 Agent 无权放行仍由 T012 A 验收，未计整条通过。
