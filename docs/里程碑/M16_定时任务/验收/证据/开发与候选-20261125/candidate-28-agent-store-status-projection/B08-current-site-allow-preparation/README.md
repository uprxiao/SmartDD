# M16 B08.2 C28 应用内站点许可正向补验

独立执行支持，仅补当前 B08.2 尚缺的**本人允许、记忆允许、UI撤销、同文档再询问、关闭失效**。不重复已通过的 C17/C19 拒绝、分区隔离、撤销与重询；不重复 B08.1 附件/导入导出或 B08.4 下载。

## 前置与执行

仅协调者在 B11 的真实资源/端口以及其他前台专项释放后启动。固定 C28 原验收包及实际受 C28 支持的、从本机官方 npm 缓存原样恢复的 Codex 0.169.0；只注册该测试根的正常执行器并走原 C19 keyless loopback provider 协议探测，不提交 Agent/model turn。公开 keyless Magpie 要求正常端点 `127.0.0.1:3425`；监听采用 exclusive，若占用立即停止，不连接或替换该监听器。

```sh
node release/m16-qa-support/b08-permission-recovery/preflight.mjs
```

```sh
node release/m16-qa-support/b08-permission-recovery/driver.mjs \
  --coordinator-authorized-b08-permission-after-b11 \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app \
  5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e \
  5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080 \
  e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5 \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/b11-recovery/verified-codex-0.169.0/package/vendor/aarch64-apple-darwin/bin/codex \
  739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002
```

首条 JSON 提供本轮全新 `root`（私有短路径）、持久 `evidence`（本目录下 run-*）、精确测试窗口标题及分阶段 `progress.json`。不使用历史 data、真实账户、Keychain 或真实网站。只复用已实际使用的 synthetic Chromium mock-cookie-key fixture，不作为任何实际系统授权/钥匙串证明。

## 唯一本人允许

1. `await-own-front`：将标题完全匹配 **WillYou · M16 B08站点权限 <本轮标识>** 的窗口置前台；等待明确允许提示。若出现真实系统授权框、钥匙串验证，停止，不允许。
2. `personal-allow-now`：确认真实应用内横条 **站点权限请求**，地址 `http://127.0.0.1:3425`、`idle-detection`，仅本人点击一次 **允许**。不点击其他按钮、不切换窗口。页面只执行原 C19 的 `IdleDetector.requestPermission()`，绝不启动/读取设备、idle 或屏幕状态。
3. `automatic-continuation`：用户不再操作。测试通过真实 CDP 控件刷新、再次请求（实际 granted 且无新提示）、管理 UI 精确撤销、等待原页面同文档真实 native front 恢复、再次请求（不同 ID）并关闭精确网页（取消、失效、无授权残留）。后一次请求出现时**不要点允许/拒绝**。

本人允许期间不发送任何自动输入。只读采样精确 owned PID、窗口/壳/页面身份、真实权限横条按钮与 native z-order、实际前台样本及精确受信任点击事件；实际 Promise 和 host/SQLite 的唯一权限记录是业务判据。不冒充实际系统前台授权。

每步保存真实 `result.json`、合成页面截图、request/refresh/同文档状态及同一 owned profile 持久行。正常退出以原 ChildProcess code=0/signal=null、原 PID 消失、闭库 quick_check、0 secret / 0 provider secret / 0 Agent turns / 0 permission or certificate exception、原本地端口释放及独立 observer 退出为准。失败保持原结果，停止依赖输入，仍按原进程正常退出时限清理；不直接修改 DB 或补造撤销成功，不复用失败根。

## 离线证据与边界

`preflight.json`：现行生产源对应 C28 manifest/base SHA、精确 C28 bundle/native/文件代理及 Codex CLI pin、原 C19 实际夹具/两次权限 ID 与源码归档 hash、现行 UI 契约、真实启动护栏的正反例、独立合成 SQLite 读证正反例、`node --check` / `check-cdp-expressions`。预检没有启动 App、listener、model、进行本人输入或访问真实用户数据；实际正向/刷新/撤销/关闭尚待执行。

即使本补验通过，仍不代表任意真实 OS 权限、相机、定位、钥匙串或真实站点登录已通过。C10/C17/C19 的既有实际拒绝、Basic、取消等及历史 M12/M15 证据按原覆盖边界复用。当前 B08.2 真实个人登录需用户确认具体站点、授权范围、最小完成标记和本人输入登录/MFA；证书当前显式例外补验如必需，独立使用原本地自签 .test fixture 正常 UI，不装系统 CA、不禁用验证。S 层未覆盖明确留缺，不以本项代替。
