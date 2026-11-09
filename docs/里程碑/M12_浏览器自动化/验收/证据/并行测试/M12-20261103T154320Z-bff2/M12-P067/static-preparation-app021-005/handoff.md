# P067005 frozen handoff (static only)

A12/T114-only，App021/source025。未启动 App/Native/模型/监听，正式新增 0。004 和此前红测未改；005 只克隆 004 明确输入，并新建空 userData、项目、receiver 配置。

先核 ready.json、static-preflight.json 和 manifest.json 全链哈希。只在协调者确认 P103002 完整退出且独立清场后取得独占 Native/UI 资源再执行。

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p067-pause-stop-app021-005/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-p067-pause-stop-app021-005/cache/node node /private/tmp/willyou-m12-p067-pause-stop-app021-005/run.mjs --execute
```

驱动终止后，独立执行：

```sh
node /private/tmp/willyou-m12-p067-pause-stop-app021-005/verify-cleanup.mjs
node /private/tmp/willyou-m12-p067-pause-stop-app021-005/judge.mjs
```

每次 initial/restart 均先完成所有 RPC、profile health，且仅一次 setup reload。随后只被动等这次 App 内容的真实可信左键 pointerdown，Native 和 DOM 连续聚焦/可见 1 秒，再装一次原 guard。5 分钟仅为人工初始握手，不改变业务超时；没有自动激活、旧输入重放、guard 重武装。

真实终端输入函数和 receiver 均与 004 字节一致：实际 Ctrl+U 清未提交前缀后，仅发原 RUN P067 / END P067，并绑定本轮 PID/PTY/run 和原生事件。原 A12、S01–S06、C01、T00、C02 共10条判据逐字未改；验收主流程只更新 App 标签。新 F01 判定实际手势/稳定焦点；新 P00 独立判定 App021/source025/实际 ASAR main。

14 组文件/内存语义控制、15 个 Node 语法检查、28 段嵌入 JS 及 Python AST 通过。动态 own 只做字符串编译和虚构内存对象控制，不附着 App；UI/helper observer 的原 this/参数/Promise/结果/恢复与 fail-closed 均有控制。见 static-controls.json、syntax-checks.json、contract-equivalence.json。

历史 App017 A01–A10 和 App020003 A11 保留原版本与已绿事实；当前 App021 适用性仍需协调者影响复核，不直接算新版全 T113。003 两 App 均正常 0/null、signals[]，不是强制清场。source024→025 精确三文件改变已列入 source-impact-review.json。

运行将生成 raw/live/cleanup 等新结果，judge 将覆盖 result.json；静态结果另永久保留 preparation-result.json。输入 manifest 是运行前冻结清单，cache 和未来运行输出不属于输入。
