# A41 本地邮件连接等待钥匙串授权

2026-11-19，macOS arm64，实包 `e66f5a85b`，ASAR `7d6df6efc403b7e455789c492bbcc37eae74e13d7729812a75def4e3bdfd6e40`。独立项目、合成发件账号，目标为不可转发的本机 SMTP。对应旧包 406 的 [原准备失败](../../3b769ef96/A41-mail-setup/README.md)。

424 加入阶段定位，在 `applications.testConnection` 期间界面 RPC 超时。对本轮精确 PID 62748 的主线程只读采样见 `SecItemAdd → makeLoginAuthUI → AuthorizationCopyRights`，定位到 macOS 登录钥匙串的系统授权路径。连接仍未保存，模型任务与审批没有开始，本机 SMTP 无 DATA。测试退出等待届满后只通过原 App 句柄清理该实例。后续在用户可参与时完成系统授权，再继续 A41 审阅矩阵；后台步骤不能代替系统授权。

[原结果](result.json) · [主线程采样节选](main-thread-keychain.txt) · [文件哈希](SHA256SUMS)。归档没有真实密码、凭据或完整测试数据目录。
