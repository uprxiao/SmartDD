# T124 R006：同一原 qa 前置的静态续接

未执行、未占资源。必须等 Root 确认新的 2–3 分钟前台可用时段并授予新完整 lease，才开新 App；不自动重放 R005，不 rearm、不抢焦点。T123 独立后置。

原 R004 qa 前置保留：真实 stdin1、Host8、unsafe0、原 App 正常退出及独立清场；原 userData/HOME/CODEX_HOME/profile/project/Cookie 同一专属输入。原 payload SHA596908351a31b8c1dd03a90f4d6c34aa5c150aeebdd0fee9220412d3bc31554c 字节不变，只发原 T124-main 与原 T124-peer-confirm 两个 turn，不重发 health/qa 登录、不读取/复制认证。执行时仅按 exact owned connection/project/loopback/合成 ciphertext 前缀恢复 T124 一个 HMAC token 到内存，不输出、不持久化、不单独哈希。原 Cookie 必须真 Native 页面与 HTTP GET 均核 qa 才继续，失效即停，无 Cookie 制造或补登录。

原 R005 仅完成合成 token 恢复、真实初始稳定焦点和两次 UI 点击；第8 guard 失焦时已按授权记录当时微信 PID99740，未完成 Cookie 验证、0 新模型任务。原 normalquit 仅留错误 hash，appExit/observedProcess缺失，不能认正常退出或 crash。Root 独立6PID/3TCP/2Unix/1helper全清。安全投影在 R005-lineage.safe.json 所指包，原 raw/代码/失败不改；不把前台观察推为用户因果。

本次变动仅新 controlRoot/title 与收尾：每个主/cleanup 错误即时写私有完整 stack；frozen harness 自有 ChildProcess 的 close 总被执行，依其原规则记录 SIGTERM（仍存活才发送，必要时原规则SIGKILL），再有界等待实际终态，最外 finally 保存 observedProcess。原 normal wait 结果、fallback final wait 与 actual signals 分开；未确认的正常退出不编0/null。frozen waitForExit 会先关闭 main inspector，focus guard 只拦 UI 输入、不拦 quit；R005缺 stack 无法判定具体退出失败原因。

原 guard、UI/模型/单次sender/onData/消费/canonical ACK/rate-menu、沙箱 workspace-write/on-request、真实工具审批和五业务测试 body 均保持。仅 continuation 收尾完整性新增 normalExitConfirmed 真值要求，不放宽任何业务判据。原 combined judge 与 detached五业务逻辑保留；原 AX有限表示读取不变。所有label仍在permit/App/secret之前做全import闭包门闩，G1 prefix AST+dummy VM合同保留。纯stub覆盖正常、normalwait错误、close错误三条收尾路径，均始终观察原owned process；无真实OS/进程操作。

Root grant 新 lease 后命令：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t124-real-R-cont-006/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t124-real-R-cont-006/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t124-real-R-cont-006/run.mjs --execute
```

退出后先独立 cleanup，再纯文件 judge：

```sh
env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t124-real-R-cont-006/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t124-real-R-cont-006/cleanup.mjs --verify
env NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t124-real-R-cont-006/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t124-real-R-cont-006/contract-judge.mjs
```

新 runtime/lease 不存在。未读原DB/Cookie/auth/合成secret，没有新App/Native/OS/HTTP/模型。safe交付排除 App/DB/WAL/SHM/auth/Cookie/真实或合成token/完整Native/私有截图/调试端点；formal新增0，最终由Root安全与原合同复核。
