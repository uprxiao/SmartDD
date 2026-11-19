# G03 候选 1c9022486 的业务与委派回包故障复验

冻结 commit 1c9022486b5425bd8a092e99506b0c99aa6a81e0，ASAR 6ea0906fe3d56d93d39b42be6d9458fc99458707bdecd0a54115fcfc637d4604。使用合成模型与独立 HOME/userData。两次候选 App PID 都已离场，3425 已释放。

## A27 邮件副作用回执

- 039 常规执行沙箱拒绝本机监听 EPERM，App 未启动。该前置与应用无关。[结果](attempt-039/result.json)
- 043 使用授权的本机回环后成功启动隔离 App PID 89878，两端只监听 127.0.0.1。在 SMTP 连接准备时主线程阻塞于系统安全框要求授权。采样命中 Security::KeychainCore::StorageManager::makeLoginAuthUI，数据库无接入连接、业务请求或发送执行，没有外部网络或测试邮件发送。正常退出尝试超时，驱动用原 ChildProcess 句柄结束了本轮 App。独立收尾再次核验时已无该进程，未再发信号。人工前置保留到用户参与时。[结果](attempt-043/result.json) · [线程样本](attempt-043/keychain-owned-thread.txt) · [私有库计数](attempt-043/isolated-db-counts.txt)
- 正式用例要求通用业务效果未知，已准备不需要连接或钥匙串的独立本地插件写入方案。此路线不追认 SMTP。 [本地效果方案](../prep-next/a27-plugin-local/README.md)

## A24 原生委派回包

- 042 使用实包与真实 Claude MCP，已实际对上唯一 wy_observe 原生 call id。原生响应是应用通道未完成的显式错误，没有正文。初版驱动将历史 wy_delegate 参数里的 marker 当成读回正文，在采样门闩命中前就结束了。真实断开有原生侧证，完整的门闩命中与续读尚无打包证据。App PID 93341 正常退出 0。 [原始结果](attempt-042/result.json) · [原生调用与原生错误](attempt-042/native-matched-wy-observe.json)
- 同法核对早期 024，原生 observe 的对应回执明确含正文与同一子任务修订 1，验证仍成立。 [024 的真实成功回包](attempt-024/native-matched-wy-observe.json)
- 驱动改为按原生 tool_use_id 匹配成功／错误，并在失败时保存门闩记录。原 042 的驱动及结果按当时哈希保留。新复验用 attempt-044，需另领 App 槽。 [精确原生回包匹配](../prep-next/a24-claude-observe-evidence.mjs)
