# B09.2 其余八原态：纯自有本机活动、来源检查与证书拒绝

本批对应原已验证1440但缺1920的剩余8态，浅深×480/900=32原键、旧新64取证行。与安全16态同属剩余24态，但分批独立运行，不修改之前数据或已冻结驱动。尚未启动任何 App/本机服务/真实模型、实际结果仍待。

## 执行（其他桌面测试资源已释放后）

```sh
node release/m16-qa-support/b09-recovery/next-safe8-certificate-resume/preflight.mjs
node release/m16-qa-support/b09-recovery/next-safe8-certificate-resume/driver.mjs --coordinator-authorized-b09-safe8-certificate-resume \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/old-reference/WillYou.app \
  697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2 \
  3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040 \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app \
  5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e \
  5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080 \
  e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5 \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/b11-recovery/verified-codex-0.169.0/package/vendor/aarch64-apple-darwin/bin/codex \
  739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002 \
  --native-a-fullscreen
```

旧、新各一个独立 App 一次实际1920外屏全屏；仅选中准确窗口 **WillYou · M16 B09 1920 安全八态 旧版/C28 <尾号>**，实际AppKit前台守卫120秒、连续3秒才允许正常原生 A 几何。若守卫不能成立，使用本人绿色全屏路径，实际焦点/原窗口/外屏/DPR/zoom均核实。宽度复用WlfF3b焦点修正：正常地址点击后真实Shift+Tab逆序到实际 separator，再实际键盘10px逐级；未直接改DOM/store/几何。后台CDP仅页面A，不把系统操作算S。需要原本机3425、61917、61181端口与每边独立随机本机TLS端口，均exclusive自建；不使用其他服务。

## 原状态与真实、安全业务路径

- **B13-import-source、B13-import-confirm、B13-import-missing-browser**：新私有 HOME 和 CLI HOME 内分别创建两条原合成来源名称和普通120B仅存在性标记（非实际Cookie数据库，不读标记内容）。旧实际包使用Node HOME，C28使用显式CLI workspace HOME；已核两实际 app.asar 的精确 source root、源选择ID路径哈希、发现只读、缺失早退在源读取及目标事务前，运行时再核实际进程两私有home与实际发现ID。真实界面发现→下一步→确认展示→返回→取消→完成（不提交）。缺失态第二轮选择同一精确合成Default后才在两自有根中移开目录；点击确认前反复核同源确切不存在、另一仅占位项存在、原真实选择，实际必须返回唯一“所选浏览器或profile已不存在，请重新选择”，再关闭，0目标事务journal、同profile/WC/doc、还原同inode/size/metadata。不会发起存在来源的真实导入，不访问日常浏览器或系统安全存储。若结果未知，保持目录缺失至原App正常退出，绝不处理系统许可或复原进行中的请求。
- **B05-certificate**：原M12合成自签名TLS证书配置（实际已核SHA），新本机TLS服务监听127.0.0.1，仅精确合成 m12-cert.test 本机地址映射，未改系统网络或证书信任；两实际包的Runtime再次核不含忽略证书错误或关闭Web安全的flag。真实用户UI输入，预期 actual ERR_CERT_AUTHORITY_INVALID、challenge/原profile零信任、原native无前景遮盖实际告警。读取两按钮及普通hover，仅关闭确切原warning网页，禁止继续访问；本机HTTPS请求必须0，profile证书保持空。
- **B09-agent-active、B09-agent-hold、B10-paused、B10-resumed**：真实普通原生 Codex 0.169.0，以C25已实证的同一固定自有本机页面只读 managed browser wait业务路径；真实用户提示词、正常 runner、同一自有task/page/run/turn。第一次实际wait在线，真点暂停并观察真实 `BROWSER_PAUSED` typed回执；真恢复后、第二次命令前截图；再发第二次只读wait，实际本机gate释放、原native CLI result v2成功、20秒hold真实可见。记录全链实际原native文档、前景、UI pill及hover、七像素dot/提示说明。仅调用严格固定的已声明合法本地只读等待工具、没有跨任务/外部资源控制、无批准；若出现系统或其他用户授权则中止，不代批准。任务正常归于idle后关闭。本地fixture与managed回执契约均原SHA不变。

首条stdout输出本轮私有根；`progress.json` 及 `B09-safe8-pair-result.json` 记录真实代码包、实际业务回执、UI截图、恢复与退出。`python3 release/m16-qa-support/b09-recovery/next-safe8-certificate-resume/review.py <实际根>` 校验原图SHA并产实际派生配对审阅板；其不是目视自动通过。`preflight.json` 只有静态与纯自造目录存在/缺失/恢复守卫验证，无真实A/S或截图。
