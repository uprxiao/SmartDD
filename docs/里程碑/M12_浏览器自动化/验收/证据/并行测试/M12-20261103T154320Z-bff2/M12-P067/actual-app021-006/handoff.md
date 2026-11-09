# P067006 final static handoff

App021/source025 A12/T114-only, no oldgreen queue/A11 replay. Originalten A12/S01-S06/C01/T00/C02判据、验收主流程、Ctrl+U+strictRUN/END、receiver、UI/helperobserver、原guard字节不变。

WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p067-pause-stop-app021-006/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-p067-pause-stop-app021-006/cache/node node /private/tmp/willyou-m12-p067-pause-stop-app021-006/run.mjs --execute

驱动退出后独立执行：

node /private/tmp/willyou-m12-p067-pause-stop-app021-006/verify-cleanup.mjs
node /private/tmp/willyou-m12-p067-pause-stop-app021-006/judge.mjs

仅两runtime差异：每phase全部RPC/health→once setupreload→被动exactPID/exe/userData Nativewindowfocus+DOMfocus+visible连续3s（记录samples/elapsed/reset）→一次原guard；去掉人工pointer，不steal、不伪receipt、不重武装。无task或无observer安装尝试时，恢复观察器明确skip且Native requests0；已经尝试安装的真实restore错误仍原cleanupErrors留证。

仅从005明确228inputs克隆224非runtime项，4个receiver/config输入由原source/固定config重新生成，空userData/project新建，无旧runtime/raw/started。15组原schema/ownership/PIN/observer/RUN等静态控制+5被动focus控制，F01九个负例均拒绝，17Node语法/PythonAST/25嵌入JS绿。

旧App017 A1-A10/历史App020003 A11的当前App021适用性仍Root影响复核，不自动算全T113。003仍正常0/null/signals[]，不是强制清场。准备Native/App/PTY/model/listener/auth0，formal0，输入已冻结。模型parser未知格式只影响判定，不应推断安全风险，本组不发送任何模型。
