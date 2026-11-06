# T145 close observer 工程诊断准备

只诊断 headless about:blank 关闭生命周期，不重采8P图、不启动Vite/原型/WillYou/模型、不访问认证或真实Keychain。原004两次关闭错误仅有name/hash，原因继续unknown。即使本组无法复现，也不能把原红改绿或声称原因已解决；原算法与hash依据见 `original-close-algorithm.proof.json`。

固定相同Node/headless SHA：page CDP WebSocket发送Browser.close两次，browser-root WebSocket发送两次，各独立新私有profile。另一次明确标FI：browser-root发出close后主动关闭本次WebSocket，只验证传输出错时观察器仍等原child，不伪造原004异常。每条仅一次Browser.close，about:blank无网页业务/外站请求，不增加命令重试。

`transport.mjs`完整保存请求、原始response、WSclose/error的私有时序与完整错误stack；ChildProcess stdout/stderr、exit/close/code/signal和自发信号同时留证。新两阶段观察：close发送后单独观察原child最多5000ms；RPC结果只记录，任何RPC拒绝都不会跳过等待。只有实际child仍活着且完整5000ms已过才允许原句柄SIGTERM，额外3000ms仍活着才SIGKILL。提前结束观察只能因为实际child已退出。原算法若遇RPC早拒绝可能进入finally的推演仅为本次事件的counterfactual，不运行旧的立即信号路径，也不外推原004。

判据保持实际child正常0/null/signals[]、完整trace、fallback不得早于5秒、独立exactPID/TCP/headless-helper出生范围全清。FI仍明确记录实际退出与信号，不能为它伪造正常。新HOME/ZDOTDIR/TMP/profile/cache独立、child env显式allowlist，无process.env spread、无真实凭据。runtime目录在Root租约前必须不存在；静态准备只做解析/哈希/FS形状，未调用transport或child观察函数。`driver-file-access-map.json`列全部25FS调用、静态输入/Rootcontrol/运行输出与5条有限路径。

Root签新lease scope=M12-T145-close-probe，Native/HTTP/TCP/Unix/OS完整资源并绑定READY SHA后执行。该组不需要系统前台，不占编译器，当前未授资源，禁止启动。

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t145-close-probe-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t145-close-probe-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t145-close-probe-001/run.mjs --execute
```

原driver终态后，在本组租约仍有效时独立清场（只读，不杀未知/日常进程）：

```sh
env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t145-close-probe-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t145-close-probe-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t145-close-probe-001/cleanup.mjs --verify
```

确认全部自有资源收尾并释放后，纯文件判定：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t145-close-probe-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t145-close-probe-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t145-close-probe-001/judge.mjs
```

日志含本次私有debug WebSocket URL，只留私有原件，安全交付仅时间/长度/hash/状态，不公开完整trace或端点。严格保留任何新红和原004红，正式新增0，T145 A不因该工程诊断通过。
