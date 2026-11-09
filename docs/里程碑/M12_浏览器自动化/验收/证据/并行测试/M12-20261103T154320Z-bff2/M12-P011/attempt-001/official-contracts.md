# 固定资料与边界

本机 Electron 包为 42.11.14，ABI146；完整本地类型声明和二进制哈希见 `source-provenance.json`。固定版本的官方 [Session 文档](https://raw.githubusercontent.com/electron/electron/v42.11.14/docs/api/session.md)说明：verifyProc 的结果会由网络服务缓存；closeAllConnections 关闭连接，clearAuthCache 处理 HTTP 认证缓存。本实验因此比较实际行为，不把重装处理器或关闭连接自动视为清除证书信任，也不执行 clearAuthCache 臂。

官方 [WebContents 文档](https://www.electronjs.org/docs/latest/api/web-contents#event-certificate-error)定义证书失败事件及 isTrusted 回调；本机 42.11.14 类型声明已交叉核对。事件允许回调本身是否能在后续撤销时再次触发，仍需实测。

官方 [WebRequest 文档](https://www.electronjs.org/docs/latest/api/web-request)说明仅最后安装的监听生效。将来证书 gate 与 Cookie 导入期间的全 profile 阻断必须通过一个 Session 请求分发器组合，不能各自覆盖或把监听置 null 后丢失另一保护。建议先检查导入隔离，再检查当前证书例外，再交给其他请求策略和观察者；本轮只记录要求，不测试或实现 Cookie 导入。

Orca 固定提交 `bd9455b61655b9e76504349a6c8571f74f14954f` 的原文件和 MIT 许可保存在 `source/orca/`。它以 certificate-error 对证书身份答复，并在 onBeforeRequest 对已缓存的例外请求再次检查授权。它的 local-host 授权范围、guest 粒度和临时授权流程不能直接替代 WillYou R01.5 的任意主机、profile 范围及持久化规则。本轮只比较底层撤销机制。
