# P027 实际Cookie事务组件 I 交付

独立判定12/12 passed-component-I。只验证实际NativeBrowserCookieStore + BrowserCookieTransactions + BrowserImportJournals；不计T081完整通过。没有网站、窗口、用户桌面输入、M11、agent-browser、PTY或真实Chrome/Edge登录态。cipher为本轮独立合成AES-256-GCM，明确不代表OS safeStorage/Keychain验证。

准确命令：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p027-executor-001/cache node /private/tmp/willyou-m12-p027-executor-001/run.mjs --execute
```

本轮 2026-11-04T05:05:51.520Z 至 2026-11-04T05:05:53.228Z，5个Electron进程严格顺序；每次前一整树absent才启动下一进程。每个进程最前setActivationPolicy('prohibited')成功，所有窗口数0，仅未挂窗口的about:blank NativeStore视图。没有运行HTTP网站/HTTP服务器/调试TCP监听。

| 阶段 | 实际结果 |
| --- | --- |
| live PID92827 / exit0 | 正常apply实际完成X/Y→X/W，Y和范围内DomainAttr删除、Z保持，journal清理；lost-ack分支在真实W set已经fulfilled后才由私有store代理抛ack丢失，fault snapshot证实W真实存在，实际事务自动恢复全部原7条（3CHIPS、domain/flags/expiry/priority/sourceScheme/sourcePort），W删除且journal清理；同profile在实际snapshot结束但prepared日志尚不存在的延迟门闩处，第二apply返回RESOURCE_BUSY，native调用计数1→1不变，释放后原apply独立完成。 |
| prepared-partial PID92851 / exit17 | 实际apply写真实加密prepared日志，完整clear后首个Xnew实际set并flush，原生partial snapshot中Xnew与Z存在、W尚未发。日志及Cookie均已实际落地后主动app.exit17，绕开事务catch/rollback；这是明确的受控骤退，不称正常store.close或SIGKILL。 |
| recover-prepared PID92861 / exit0 | 新Electron同userData/同partition，不重新seed；实际看到prepared日志与持久化部分Xnew，网站导航只有about:blank。真实recover返回restored，原7条所有schema字段及3CHIPS完整恢复，W不存在，prepared日志移除。 |
| committed-cleanup-pending PID92871 / exit0 | 真实apply全部Cookie+flush+真实journal.commit已完成后，仅私有journal.remove代理故障；收到BROWSER_UNAVAILABLE/stage cleanup，真实journal.phase=committed，实际X/W/Z成功状态保留，不回滚。正常关闭进程后继续下一阶段。 |
| recover-committed PID92883 / exit0 | 新进程同U/partition实际先读到committed日志，真实recover返回committed；只移除日志，native set/remove/flush调用计数=0，恢复前后与上进程的成功Cookie状态完整相同。 |

故障作用点全部显式：lost-ack在真实NativeStore.set(W)返回之后抛出；并发门闩只延迟真实snapshot返回；prepared受控退出在实际prepared日志/首写/flush完成之后；committed仅拦截真实commit后的remove。实际NativeStore、Transaction、Journal生产类和CDP/Session实现均未改写。代理只在本进程测试函数局部存在，没有生产全局hook。

加密日志使用真实BrowserImportJournals原子写入/commit/read/remove；文件0600、目录0700，ciphertext无合成Cookie明文标记，实际跨新进程解密并恢复。AES随机32字节key只在私有runtime0600文件与进程内存，新进程共用；最后pending=[]后删除，独立access确认不存在，未入manifest/日志。未验证系统加密服务或真实外部浏览器密钥。

最终独立ps/lsof确认全部23个已观测自有PID不存在，无TCP监听。4个正常退出阶段真实store.close、debugger detach/contents destroyed、观察listener移除、Session连接关闭均记录，剩余webContents=[]；prepared阶段故意未显式store.close，其整个原树在recover进程启动前已消失，不能把它写成正常close。cleanup.json保留每阶段实际PID过渡与最终清场。

输入：冻结1516 manifest476fafd8a561fdc50ca6b9fc84a2d97868553cc00c3fe46431cdd1abca88720d，前后SHA全匹配；compiled-host4fab536708d6e709119653e0883def3216a9344db74051f1abbff1ca3de44345，14实际生产源快照、49实际依赖源含tldts/core7.4.18、zod4.6.7，执行Electron42.11.14/d9a9add3。单CJS组件bundle，无App重打包/SQLglob/Helper；只读冻结源，不读主树新coordinator。准备阶段一次manifest数组/字典形态错误留preparation-failure-001，纠正输入解析后未重放任何业务。

边界：本组不验证用户授权、完整导入协调器/page-pause/网络门禁、真实来源解密/Keychain、OS safeStorage、无页面残留ServiceWorker或完整App A。root后续journal clear-intent方法不在本冻结/本轮；原phase/transaction机制只按本源版本验证。所有Cookie与目标profile均合成。本组无新native工作，交付后冻结。
