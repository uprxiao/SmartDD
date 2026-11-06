# M12-T080 当前 App026 完整 I 静态交接

仅原 T080：真实打包 App 的 Chrome/profile/目标选择、风险确认、结果摘要及完成通知，加真实受管 stockCLI 数据核对。当前未执行，不能据本目录归账通过。Root 独占公共账与实际调度。

原合同全文与 R1.6/B13 来源见 `original-contract.json`。P027/P029/P105 的已有工程 I 与11个未变 cookie-import 模块的逐份 SHA 见 `reuse-applicability.json`；它们不代替本轮真实 UI/CLI，不重跑 T081 故障矩阵。实际包身份为 packaged App026/source030，见 `pin.json`、`capture-pin.json` 和 `source-proof.json`，不是旧包或 installed 路径冒充。

这不是模型 R。`receiver.py` 沿已验 S6 的阻塞合成 I caller：只做合成 health/config 握手，并由真实 TaskService/ManagedLauncher/PTY 调用真实 signed `willyou-app`，保存数字退出码与唯一 Host operation/request/run/task/project/package 绑定。无 OpenAI、登录、认证复制或真实账户。

F-COOKIE 通过原 BrowserService 公共 `cookieImport` 构造依赖注入：私有 Chrome 目录、已知合成口令 keyProvider、仅本进程 AES journal cipher。实际 renderer/controller/import coordinator/NativeCookieStore/CLI 不替换。启动 inspector 的 exact App/userData/inspect 门闩、mock-keychain 与限定 Mail Worker execArgv 作用点及恢复见 `fault-boundary.json`。真实钥匙串 T083 不在本组。

完整路径：非受验 API 前置、真实 CLI 原值读回全部完成 → 一次 setup reload → 固定 `[A/I] T080 App026` 标题 → 既有用户授权481e脚本准确 PID 首次激活一次 → Native+DOM 连续3秒 → 一个原 focus guard → 真实 UI 打开右侧网页、来源 Profile1→Default、目标 decoy→原XYZ profile、风险确认一次 → 完成页 DOM/ARIA/截图 → 真实 CLI 四域读回。失焦立即记录已授权的前台名称/PID及私有错误，正常收尾；不 rearm/切回前台/重放。

原 F-COOKIE 摘要固定：总数4、导入3、跳过1、其中Google1、分区保留0、目标原有保留1、重载页面1。`qa` 为新X/W，旧Y移除，其他域Z完整不变；Google排除，Youtube沿原既定规则导入。R06.4.8/B13未指定额外 toast 或 OS 通知，本轮保存实际可见 `role=status`、ARIA、可取得的 AX 与截图供 Root 判语义，不预写通过。

本轮 `runtime-001`、`execution-started.json`、`raw.json`、lease 必须在派发前不存在；已建的只有静态代码/依赖与私有 cache。`permit.mjs` 在任何运行目录、App或监听前强制校验冻结 SHA/mode、实际 pins、目录形状与 Root 新 lease；`check-labels.mjs` 先校验所有静态分支 mainEvaluate labels。`static-preflight.json` 只含 AST/生成字符串/SQL列参数契约，未执行生成 body。

执行需要 Root 明确授本组完整 Native/UI/App/PTY/HTTP/TCP/Unix/OS 资源，且桌面实际可用、满足原焦点/系统前置。不给休息用户发解锁或授权问题；实际锁屏、无法取得原真实焦点、缺原系统前置或无租约则延后，不绕过。当前无租约、不可启动。Root 写 `lease.receipt.json` 后使用以下完整命令；每条独立执行，禁止重跑本次业务：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t080-App026-full-I-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t080-App026-full-I-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t080-App026-full-I-001/run.mjs --execute
```

driver 无论业务红/绿先保存 `raw.json`、私有 stack、原退出观察。随后独立只读清场（必须当前完整资源仍属本组，不能漏 argv/env）：

```sh
env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t080-App026-full-I-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t080-App026-full-I-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t080-App026-full-I-001/cleanup.mjs --verify
```

确认自有资源释放后纯文件原合同判定：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t080-App026-full-I-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t080-App026-full-I-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t080-App026-full-I-001/judge.mjs
```

清场只核本次记录的准确 PID、TCP端口、Unix socket及parent、按userData/pageId计算的helper运行文件。normal exit需原App0/null且signals[]，独立absence不代替正常退出。仅原ChildProcess fallback发SIGTERM/必要SIGKILL时分别记事实，不造normal；禁止处理日常/未知进程。截图、原 DB、完整 runtime、debug端点不直接归档；执行后另作必要安全投影，保留红和环境/夹具错误。该准备新增通过数0。
