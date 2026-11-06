App025 cachefix 最小工程I，仅1条实际 readonly browser identity get。复用P108真实打包Host/TaskService/Native/stockCLI＋本机synthetic Responses；不需前台，不输入UI，不连接OpenAI/读复制auth。完整原criteria未扩展；这不是T125或真实R通过。

原producer仅发一条实际工具，工具输出到达后暂停final回应，保持Native活跃，Host内存中的本轮run token仅用于扫描新CODEX_HOME后返回命中数/类别。最终放行，实际tasks.kill并读DB stopped/revoked和tokenbinding消失，再正常App退出及原独立cleanup。快照开关不经test覆盖，仅生产Managedlauncher最后追加disable。

Root审查并写绑定READY SHA的0600 lease.receipt.json后：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-cache-fix-host-I-004/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-cache-fix-host-I-004/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-cache-fix-host-I-004/run.mjs --execute
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-cache-fix-host-I-004/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-cache-fix-host-I-004/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-cache-fix-host-I-004/verify-cleanup.mjs --verify
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-cache-fix-host-I-004/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-cache-fix-host-I-004/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-cache-fix-host-I-004/judge.mjs --judge
```

保持workspace-write/on-request；不自动批准。发生审批或格式/资源错误停在原失败点，不重发命令。旧on活跃阳性/off阴性只引用。原App/缓存/Native/认证未复制。
