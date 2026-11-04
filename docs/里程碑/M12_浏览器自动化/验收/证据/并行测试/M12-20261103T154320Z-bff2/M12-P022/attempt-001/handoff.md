# P022 / T016 App A 首轮后置交付

结果：blocked-system-native-focus。T016与T026认证子集均未执行、未通过，不是认证产品红。只完成私有项目/AI profile/合成真实PTY前置、健康检查、一次setup reload与一次已授权的新实例初始focus尝试。

唯一实际运行 2026-11-04T04:14:29.361Z 至 2026-11-04T04:14:34.668Z。App010 PID79629，driver79627；监听server59556/main-inspector59561/CDP59557。实际固定ASAR c31b4f706c5ea9a7ba89ab44f47a9ae2935d34543a0c0a6d6438e399a70bd25e，0.1.1 arm64；2769构建输入清单44247dcc82197e2cdfe37494597c402245a277f80657ad9ccb20d822c8baa1bb前后SHA全一致。

真实状态严格分别保留：

- 初始focus函数：document.hasFocus false，requested=true，随后document.hasFocus true、visibility visible。
- guard首次业务点击之前：document.hasFocus true、visibility visible，但native ownedWindowFocused=false。guard checkedInputs=0，blockedMethod=P022.MainUiClick，yieldedAt=2026-11-04T04:14:34.359Z。
- 不把HTML document focus当native window focus。guard拒绝后没有重新武装、继续点击、重启App抢焦点或调用其它共享焦点UI。

实际actions仅一条测试窗口[A]隔离标签。服务器requests为空；尚未创建网页标签、导航认证接口、取消、重试、输入账号密码或登录。因没有业务证据，预先准备的完整adjudicate.mjs没有运行；独立adjudicate-focus-yield.mjs核验真实guard终止、零业务、原输入与实际清场，产生result.json。

退出后仅停止本轮合成任务/PTY（taskId=0e6dd8b7-1bab-4d19-bbd6-56ab1ade9d77，receiver PID79721），关闭本轮App和server。独立ps/lsof对7个自有PID79627/79629/79630/79631/79659/79681/79721以及三个数字端口逐项确认全不存在/无监听，cleanup.json保留原始stdout/状态；没有生产观察钩子，guard与CDP/inspector会话随本轮App与外部驱动关闭。原生资源已明确交还协调者。

密码规则：随机合成密码在驱动内存创建，本轮尚未输入界面、发送Authorization或进入文件；server只设计记录presence/match flag，UI动作只设计记录redacted/length，最终现存证据与私有runtime canary扫描无密码/Basic编码。未读取日常profile或凭据。

准备材料可恢复：run.mjs真实UI完整流程、receiver.py、独立full/焦点后置judge、verify-cleanup、固定13个源/驱动副本与source/package hashes。node语法6、check-cdp-expressions12字面量、6动态表达式编译、Python AST及三原生执行件SHA/X_OK均通过；没有重新打包App。只读RPC用于非验收前置与browser.snapshot观察；被验收的认证动作在脚本中均为真实mouse/keyboard，实际本轮未到这些动作。

准确原命令（原轮次已冻结，不应自动重放）：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p022-executor-001/cache node /private/tmp/willyou-m12-p022-executor-001/run.mjs --execute
```

后续等待协调者明确新的桌面/native focus条件与调度，沿新attempt处理，不复活已yield实例或为补验自动开新App。当前原生/监听资源全部释放。
