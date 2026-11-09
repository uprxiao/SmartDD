# M12-P014 技术 I 交付

范围：实际 BrowserPermissions + BrowserSiteStates、Electron 42.11.14 Session、真实原生页面权限回调与 SQLite。对应 T017 的技术 I 子层，不代表打包 App A、用户授权 UI、真实设备或系统权限验收。

冻结基线 SHA256：658cad198c5518f7698c7d19778505079850f8ccb2baea571c8247330a6f5f8c。生产 6 文件原样使用，依赖版本与 P012 相同，93 个私有依赖文件逐项校验，具体见 source-provenance.json。实际命令：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p014-executor-001/cache node /private/tmp/willyou-m12-p014-executor-001/run.mjs --execute
```

运行时间：2026-11-04T02:25:34.419Z 至 2026-11-04T02:25:35.120Z。driver PID 33202、host PID 33206；HTTP 两端口 52239/52240。驱动 exit0 只表示执行完毕，结论由原始 probe.raw.json 和独立 adjudicate.mjs 产生，18 项检查全部通过。

原始六段：首次 pending→真实 respond（合成 UI 前置）→query granted/geo 成功→reload 不重询；独立 profile B 不继承 A 且拒绝回调 code1；在仍授权过的同一 document 撤销后再次 pending，真实导航取消；child 不同 origin 独立保存与回调；真实窗口关闭取消；仅自有 renderer 真实 crash 取消。三种取消均先观察公共 snapshot 为空，再核旧响应抛 RESOURCE_STATE_CHANGED，均未产生伪造 deny 记录。

| 独立检查 | 实际结果 |
| --- | --- |
| pinned-native-runtime-and-real-origins | passed |
| secure-non-node-page-and-pending-before-approval | passed |
| actual-respond-ui-precondition-persists-allow | passed |
| first-real-geo-callback-synthetic-coordinates | passed |
| reload-no-new-prompt-and-native-query-granted | passed |
| reloaded-real-geo-callback-synthetic-coordinates | passed |
| profile-B-does-not-inherit-A-choice | passed |
| same-document-revocation-reprompts | passed |
| navigation-cancels-old-native-request | passed |
| cross-origin-iframe-delegation-precondition | passed |
| iframe-prompt-and-saved-choice-use-child-origin | passed |
| iframe-real-geo-callback-synthetic-coordinates | passed |
| close-cancels-old-native-request | passed |
| actual-renderer-crash-cancels-old-native-request | passed |
| all-location-data-is-explicit-cdp-fixture | passed |
| server-requests-private-only | passed |
| cleanup | passed |
| frozen-inputs-unchanged | passed |

位置数据仅来自 CDP Emulation.setGeolocationOverride（1.2345, 2.3456, accuracy10），未使用 Browser.grantPermissions 或替换生产 Session 权限处理器。原生 navigator.permissions.query / geolocation callback 均真实。两 HTTP 页面为同一 loopback host 的不同端口，是跨 origin、非跨 site；Permissions-Policy/iframe allow 仅作功能委派，不授予用户权限。页面实际 isSecureContext=true，require/process 均 undefined。未访问外站、日常 profile、凭据或真实设备。

实际生产 dispose 后 pending/owners/detach/sessions 都为 0，测试观察钩子移除且 listener 数恢复基线，存活 target 坐标 override 清除并脱离 debugger，4 个自有窗口全毁、SQLite 与两个 server 均关闭。独立 ps/lsof 对 8 个已观测 PID 和两个数字端口逐项确认全部退出，无 TLS 私钥生成。见 cleanup.json / process-cleanup-verification.json。已向协调者明确释放原生资源。

准备阶段仅有一个外部 require 白名单文件名拼写错误（误写为上一组 certificate-fixture.cjs）；已保存 preparation-failure-001.json，纠正为本组 geo-fixture.cjs 后预检通过，失败时未启动原生/监听，也未发业务。没有重复业务或重试场景。

边界：此批没有执行真实 App 用户点击授权、系统地理位置权限、硬件定位、跨 site iframe、进程重启后的偏好读取或持续 watchPosition 撤销；不要将这些计入已通过范围。原始输出、源码快照与 SHA、判定器、清理回执和 manifest 一起归档即可复核。
