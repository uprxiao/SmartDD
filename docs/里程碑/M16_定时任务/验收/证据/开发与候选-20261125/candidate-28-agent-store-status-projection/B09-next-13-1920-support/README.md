# B09.2 C28 1920 后续13原态批次

本批复用已经真实通过的 JoBDa3 启动、项目、真实UI与1920全屏几何守卫，以及 C21 原六态、C23 原六态和 C20 悬停证据。13个原状态、浅深×480/900，共52个原键、旧新104取证行，排除已完成的原七态。`preflight.json` 已核原S1键集、两个精确包哈希、语法与CDP静态表达式检查；实际批次尚待执行。

## 直接执行

等其他系统测试释放桌面及原本机3425 fixture端口。工作目录为 SmartDD 根。

```sh
node release/m16-qa-support/b09-recovery/next-13/preflight.mjs
node release/m16-qa-support/b09-recovery/next-13/driver.mjs --coordinator-authorized-b09-native-fullscreen-pair \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/old-reference/WillYou.app \
  697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2 \
  3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040 \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app \
  5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e \
  5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080 \
  e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5 \
  --native-a-fullscreen
```

首条 stdout 给出本轮私有 `root`。`progress.json` 实时交接；`B09-matrix-1920-additional13-result.json` 包含原真实UI行为、每态捕获和恢复结果。等待旧包正常退出后才启动新包。没有启动引擎真实任务，不触及日常邮件、浏览器档案、账号、登录、证书信任与系统许可。

`--native-a-fullscreen`（可去掉）：仅用已获授权的本轮确切原根和公开 Electron BaseWindow 原生系统 API，先实际 AppKit frontmost PID+exe 连续3s，w.isFocused，`setBounds` 移动该唯一测试窗到真实外屏，核真实匹配显示器、相同根和失焦即停；再次实际独立前台连续3s后 `setFullScreen(true)`，等待真OS全屏及1920×1080 DPR1、zoom1、内容/壳尺寸和原主题/宽度。若前置未成立或失焦，终止自动系统输入，回原普通用户全屏交接。无强制激活、无屏幕设置改动、无 `setSimpleFullScreen`、无窗口尺寸伪造；A 几何回执不计物理S。页面焦点模拟仅在真正全屏前置之后用于原CDP键盘/hover A状态，记录实际native状态及恢复。

手动路径每包一次：`WillYou · M16 B09 1920 十三态 旧版 <尾号>` / `... 十三态 C28 <尾号>`。只把这个确定窗口放到1920×1080外屏并点绿色全屏。全屏实际观察后驱动自主继续，不需要每个状态参与。

## 本批原状态

- C23 前置状态 `R01-11-launcher-empty` 先在两主题/两宽度验证真正空历史，没有网页覆盖。
- C21 六态 `B03-invalid-address`（原固定合法拒绝测试）、`B11-grants-empty`、`B12-profiles-default`、`B14-settings`、`B14-settings-restart`（仅真实待重启提示，恢复不重启）、`B14-settings-clear-confirm`（取消、合成artifact严格不变）。原native document/owner、真实modal preview、实际复原必须核验。
- C20 `B01-02-tab-hover` 持续实际 pointer、同DOM节点、完整标题及URL、真正产品native预览、ICC校验、native park、Esc同doc恢复；旧包已知缺完整tooltip按原真实差异保留。
- C23 五态 `B01-02-tab-keyboard`（真实 Shift+Tab/`:focus-visible`，C28完整短题和URL+native preview/Esc同doc）、`B01-02-tab-pressed`（实际按住/:active，释放）、`B01-02-toolbar-keyboard`（真实可用Back）、`B01-02-toolbar-pressed`（真实按住刷新/释放后本机GET）、`B02-loading-stop`（本机合成HTTP实际挂起，真实Stop/cancel，回同tab，不完成响应）。原单interaction tab真实 long→short历史与C21多tab任务分别保留。

完成后 `python3 release/m16-qa-support/b09-recovery/next-13/review.py <root>` 校验原图sha、配对原键和几何差异，生成实际图的派生审阅板。所有正式target匹配需现有审核；焦点/tooltip已确认旧差异与新修复分别归档。余态见 `reuse-inventory.md`。
