# 原 M12-T017：App025/source029 完整 A 静态入口

本目录仅准备原 T017 的 A。独立 current I 由另一执行者复用原 P014 负责，仍 pending；旧 P014 技术绿及 native 适用性差异不被计作 current I，也不使父用例通过。当前锁屏、无 Native/OS/App/CLI/HTTP/模型租约，尚无 runtime、合成证书私钥或执行结果。

真实打包 App025 使用新隔离 userData/HOME/CODEX_HOME/项目；只复用已冻结通用 harness/UI/初激/guard、原 P014 页面源码和无模型 managed receiver。setup 全部项目、浏览器选用、合成 profile 健康和实际运行前置完成后只 reload 一次，按既有 call7fa 授权仅对准确新 PID 首次激活一次，原 stable3s/guard 保持。正常流程不 rearm、不抢回焦点。

本机 HTTPS fixture：固定 m12-cert.test→127.0.0.1，随机本机端口，显式 no-proxy。无系统 hosts/proxy/trust-store 写入，无证书绕过旗标。租约内生成一次性自签证书，真实 UI「我了解风险，继续访问」只作为权限页前置；私钥最终删除、不输出或归档。原 P014 `geo-fixture.cjs` 字节不变，1.2345/2.3456/10 仅提供合成坐标，不授予权限或代表 OS/物理设备验收。

原四条业务预期完整保留：真实页面按钮请求定位→真实浏览器权限提示→真实「允许」→当前 profile/site 持久记录和真实 Native callback；真实工具栏刷新后再请求自动沿用、无新提示；真实登录态管理对准确 origin/location 行撤销，后续真实页面请求再次提示。最后由真实 TaskService managed native `willyou-app browser geolocation` 设置合成坐标，以及 `browser eval` 在页面上下文尝试点权限允许控件，均不生成站点授权；真实 Host operation/request/run/task/project/package、原 CLI 数值退出码和 pending/DB 无授权事实完整保存。合成 receiver 不是模型 R，不读取或复制任何 auth；本组原层级无 R。

A 结果仍需 Root 看真实权限条/管理页截图并合并独立 current I。0 formal 新增，执行者不改公共账。

执行（Root 新完整资源租约且 lease.receipt.json 精确绑定本 READY SHA 后）：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t017-App025-AI-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t017-App025-AI-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t017-App025-AI-001/run.mjs --execute
```

执行退出后独立清场、再纯文件 judge：

```sh
env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t017-App025-AI-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t017-App025-AI-001/cleanup.mjs --verify
env NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t017-App025-AI-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t017-App025-AI-001/judge.mjs
```

安全交付只投影必要结果/截图/代码与 hash；不归档 App、DB、私钥、运行 token、完整 runtime 或调试端点。原 P014 证据及两 native 文件差异的准确入口为 `pending-equivalence.json`；独立审核结论由另一执行者交 Root，不在这里假设或补绿。T012 静态预判成功/失败输出格式误推已在 preparation-correction.json 依据固定 native cli.mm 更正；原 T012 READY 和 judge 未改，无新执行。
