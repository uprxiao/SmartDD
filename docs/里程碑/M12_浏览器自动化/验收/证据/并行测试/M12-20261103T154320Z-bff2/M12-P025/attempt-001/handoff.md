# P025 原生Cookie组件 I 交付

独立结果 passed-component-I，11/11检查通过；不计T080/T081整条。唯一实际原生轮次 2026-11-04T04:46:16.006Z 至 2026-11-04T04:46:16.278Z，共74次实际类方法/只读原生协议调用。没有App界面、网站、agent-browser、M11、PTY或Keychain；只有Electron自身子进程及两个未挂窗口WebContentsView。

准确命令：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p025-executor-001/cache node /private/tmp/willyou-m12-p025-executor-001/run.mjs --execute
```

| 检查 | 实际结果 |
| --- | --- |
| 禁止激活/窗口 | app.setActivationPolicy('prohibited')在ready前成功，初始/四阶段/cleanup窗口数均0。只由实际NativeBrowserCookieStore.open创建未挂窗口view并load about:blank，sandbox/contextIsolation=true、nodeIntegration=false，实际Session匹配。 |
| 四组属性 | host-only/domain、session/persistent（当时now+3600秒）、httpOnly、Strict/Lax/None、High/Medium/Low、Secure/NonSecure、sourcePort8443/9443/443/8080，实际snapshot与全部输入schema字段精确一致，原生Network.getAllCookies只读输出同时保留。 |
| 完整CHIPS身份 | 同坐标X有未分区一条，以及top-a.test/ancestor true、top-b.test/ancestor true、top-a.test/ancestor false三条，四个完整key/不同值都保留，没有扁平化。 |
| Session隔离 | B在A写入、CHIPS、导入和恢复时快照始终为空。 |
| 无分区删除协议实测 | actual remove(unpartitioned X)只移除1条未分区X，removedPartitioned=0，三个CHIPS均保留。这是本次Electron42.11.14/Chromium148原生观测，不外推其它版本。随后先清完整受影响坐标再写完整before，实际整个schema状态恢复。 |
| 实际计划导入 | 用实际snapshot送planBrowserCookieImport，6项变更，包含X四种原身份、删除Y、原本不存在W；5条目标Cookie在范围外保留。先remove全部坐标，再set全部after，实际X新/W新、Y删除、Z与四属性Cookie保持，整个目标schema状态精确对比通过。 |
| 实际计划恢复 | 先remove全部受影响坐标，再set全部before；含分区变体的原10条Cookie所有schema字段完全恢复，原不存在W删除。没有remove/set交错或只恢复部分before。 |
| 原生收尾 | 实际store.flush、两次store.close均fulfilled；两个debugger实际detach事件/contents destroyed事件均记录，2个WC全毁、剩余webContents=[]，2个Session连接关闭，测试观察listener移除，窗口仍0，host87341 exit0。 |

独立ps/lsof对6个自有PID87338/87341/87343/87344/87346/87349逐项确认不存在，实际无TCP监听，所以ports=[]。cleanup.json保留原始状态。原生租约已明确释放。

输入与恢复：固定冻结1515输入manifest78b695bba278daefcc130903ca12c75a4f71fe13a35a37da071c887108529f7a前后SHA一致；单CJS宿主d70ea1951cb552c310a3e5659c7e685ecca6a15a0c28bfbc8071499af530f1c0，13个实际生产源保留source-snapshot，49个真实依赖源含tldts/tldts-core7.4.18、zod4.6.7路径/版本/SHA。runtime只有electron与node fs/crypto/net，不引入SQLite/M11/SQLglob/helper。Electron42.11.14执行文件d9a9add305ad5300278ae01231bc109a0a3468117653fbdf0971a5a2db63004c。编译纯JS快照和相关license/NOTICE一起保留；未改生产源或公共账，未重复业务。

边界：本组只验证实际NativeBrowserCookieStore与可构造readable完整快照的计划/调用者两阶段应用和恢复。opaque/unconstructible native partition、真实Chrome/Edge来源解密/Keychain、加密journal原生持久化与崩溃恢复、完整生产导入协调器/用户App批准不在本轮。journal模块只复用实际schema/identity，并未调用真实加密日志写读。根后续对opaque目标范围的纯软件修正不在此冻结计划版本，本轮没有构造opaque，不能把本结果外推到当前所有plan分支。

原始host.raw.json在每个调用输出后落盘；driver.raw.json记录真实IPC/进程树/阶段，再由adjudicate.mjs独立按schema完整状态对比。脚本exit0没有替代业务判定。Cookie值均为本次合成测试数据，无日常profile/真实登录态。
