# B09.2 现行统一任务输入区：真实观察／控制审批

依照 2026-11-27 用户已确认的 R10/B09.2 映射，原 `B11-access-observe`、`B11-access-control` 两个历史视觉状态按 M14 的统一任务待处理请求验收，原编号与 **16 个尺寸/主题/宽度/模式键、32 旧新取证行**不变。未涉及 `B11-grants-populated`，不授予任何浏览器控制或观察权限，未触及系统许可/登录/证书。

## 直接运行（桌面测试释放后）

```sh
node release/m16-qa-support/b09-recovery/mapped-approvals/preflight.mjs
node release/m16-qa-support/b09-recovery/mapped-approvals/driver.mjs --coordinator-authorized-b09-mapped-approval-pair \
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

固定包/native/file broker和已核官方真实 Codex CLI 0.169.0 哈希。只读复用该官方可执行文件，不触及 B11 活动根。每包 fresh `/private/tmp/willyou-m16-b09-c28-side-...`、独立 HOME/CLI HOME/userData/工作目录、公用本机随机端口的无Key合成 provider。先核空 task/provider/secret，再绑定；最终 secret 为零。

旧包与C28串行，每包精确 1440×900 常规原生窗口与同一真实外屏1920×1080 DPR1/zoom1 系统全屏。**1440** 若自然前台不足，进度文件 `await-user-focus-mapped-1440` 时只使该精确测试窗前台3秒，驱动按正常原生 API 设置实际尺寸；**1920** 可选参数尝试同原有 AppKit 真正PID/程序路径、连续3秒稳定及失焦保护的公开原生全屏 API，仅作为 A 级实际几何；不成立则本人正常点击绿色全屏。窗口准确标题：`WillYou · M16 B09 统一网页审批 旧版 <尾号>` 与 `... C28 <尾号>`。两种实际几何均核原root/shell、外屏位置、内容与CSS尺寸、DPR、zoom。无强制激活或屏幕设置修改，无系统/物理 S 结论。

## 实际业务路径

1. 每包新建唯一同项目目标任务及两个独立申请任务。各自普通真实 UI prompt 完成原生 Codex 绑定；只在目标自己的页面 UI 中打开本机静态目标网页（精确唯一 tab ID/URL），申请任务各有独立、无表单/脚本/账号的本机视觉上下文网页。无真实资源，也不向目标发任何读取/控制命令。
2. 复用历史 C10/A48 实际的 Responses→原生已声明 MCP `browser_access_request_v2` 正常路径。模型 fixture 只允许一次 observe 和一次 control permission **request** 发送到刚刚核实的同项目自有目标；只返回真实工具 awaiting_user 结果。未使用 shell 命令、grant RPC、直接构造业务请求、插入数据或审批。未知路由/工具拒绝，外部代理请求阻断。
3. 两条持久原 requestId 各跨8真实尺寸/主题/宽度组合保持同一任务、同一 target/page、同一 pending phase；核实际 capability_runs、binding、request DB及原生工具回执。真实 UI 显示目标任务、唯一完整 URL、同一项目/仅本运行说明、observe（允许观察/拒绝）与control（允许观察/允许控制/拒绝），编号、未选状态、真实说明、输入区与原生面板实际边界。保存原壳图、实际独立 native PNG/placement、完整读回的控件几何与样式。
4. 截图后真正只点「拒绝」→「确认」。DB 原 request 变 retired、revision递增、真实 system_notice 为用户拒绝，原 request 不再显示、无 resultItem grant、无任何 grant，正常 native 状态通知不发工具。原目标标记及页面 ID/URL 保持。同一条的所有真实截图仅在该原拒绝结果核实后成为可配对行。若未知目标/回执或权限前置不满足，停止受依赖动作；只对确证专属于本轮隔离目标的 pending 请求正常拒绝，否则正常关闭本轮App，无真实业务/授权。

## 依据、证据与边界

`preflight.json` 含原 S1 的16精确键、原 C10 A48 实际记录、原真实驱动/model fixture hash、旧/新实际 app.asar 中相同的 M14 host 注册/真实 awaiting_user/denial 分支及当前卡片/模式说明、CLI pin、语法与CDP静态表达式检查。原 C10证据历史确曾进行授权，该历史事实不会被重演；本轮只申请后拒绝。解析器测试只是静态合同检查，不代表实际发起。

首条 stdout 给本轮根；`progress.json` 与 `B09-mapped-approval-pair-result.json` 实时记录每包真实绑定及请求/原页面/截图/拒绝。旧原ChildProcess正常退出后才启动新包。

执行完成后 `python3 release/m16-qa-support/b09-recovery/mapped-approvals/review.py <本轮根>` 逐真实原图核 SHA、生成独立审批目标区旧新对照板与几何/像素差；任务ID和上下文文字可能不同，不追认全图逐像素一致，实际目标评价另行审核。所有注册、截图、拒绝/结果和系统关闭均以实际运行证据为准。**当前仅静态准备，尚未启动 App、原生请求或真实截图。**
