# M12-P045：原 T082 完整 I 交付

建议原 M12-T082 完整 I 通过。独立 `adjudicate.mjs` 根据已落盘的原始输出和独立清场结果判定 9/9 检查通过；没有依据驱动退出码直接推业务通过。公共用例账由协调者复核后更新，本执行者没有修改。

## 原合同及实际判据

`contract.md` 保存原 T082 与 F-COOKIE 的读取快照和源文档哈希。合同要求同一 profile 并发两次导入，第二次被拒绝或排队，不并发写，最终 Cookie 与单次导入一致。原层级是 I。本轮没有执行 T075 clone 矩阵，没有将结果外推到 App A、真实 Agent R 或 OS Keychain S。

实际在一次真实 Electron 中调用两次宿主受信用户 `BrowserService.importCookies(taskId, profileId, sourceId)`。该入口本来是用户专用，因此没有新增 Agent 导入命令，CLI 只用于目标页面创建、前置读回及最终读回。

1. 实际 BrowserCookieSources 从本次私有 Application Support 发现合成 Chrome Default，读取其真实 SQLite Cookies 库，按 v24 host hash / v10 AES-CBC 解密、校验及计划。Default 含 qa.example.test 的 X新/W、google.com 的 G来源、youtube.com 的 YT。另有独立 Profile 1 不可解密条目，未选择或导入，不声称 T081 的失败矩阵已通过。
2. 非被验收前置用真实 Session 写入 qa 的 X旧/Y、other.example.test 的 Z、google.com 的 G原值；4次真实 CLI cookie get 确认前置实际存在，YouTube 初始为空。
3. 第一导入暂停在首次实际来源 keyProvider，状态为 importing。门闩在来源读解密阶段，尚无 NativeStore 写入、无 journal。门闩有 30 秒上界，原方法结果未被替换。
4. 第一仍等待时发起第二次真实 importCookies。第二在冻结生产 assertImportable 返回 `BROWSER_UNAVAILABLE`（“请先处理该登录态的恢复记录”），立即拒绝；不是预设成 RESOURCE_BUSY。原合同允许拒绝。第二前后目标 Cookie 完全相同，keyProvider 总计仍1次，NativeStore调用仍0。
5. 放行第一后，默认生产 coordinator / NativeBrowserCookieStore / BrowserCookieTransactions / BrowserImportJournals 完成一次导入。摘要：total4、imported3、Google排除1、其他跳过0、preservedTarget2、reloadedPages1；最终状态 ready，journal 删除，临时转移的来源密钥被擦除。
6. 只读计数包装始终委托原生 NativeStore 原方法，记录恰好4次 remove（qa X/Y/W、YouTube YT）与3次 set（qa X/W、YouTube YT），全部 fulfilled，最大同时执行数1。第二导入没有进入来源解密或写入。最终已恢复两项原 prototype 方法。
7. 放行后的4次真实 M11/native CLI `cookie get --url` 结果精确匹配单次导入夹具：qa 仅 X新/W、Y不存在；other Z保持；Google G原值保持且来源值未导入；YouTube YT成功导入。全部是实际 HttpOnly/session Cookie，path=/。没有直接改 native 状态制造结果。
8. SQLite 真实操作账只有1条 `ui cookie import`，succeeded / completed；第二拒绝发生在该用户操作账入口之前。

原始结果见 `driver.raw.json` / `host.raw.json`，真实 CLI stdout/stderr/退出码逐次保留。实际9次 CLI = 创建目标标签1 + 前置读回4 + 最终读回4。

## 冻结来源及复用

源码最终依据 App012 完整不可变输入：`/private/tmp/willyou-m12-p041-build-001/source`，Git `edfa6e9e48a40b206a954ce0ea1be1bae9afc2af`，2844文件 manifest SHA `655abb9970e460ea64f424a6b9f5b9d3203d30412c11128c95509fda352166ab`；另原 P039002 / 279静态补充清单保留。合计3085源/静态文件前后逐SHA匹配。

复用已归档 P039 manifest SHA `227de44697e9864729041990064e41e6ffda5da03d10e9cb0de2f2f8554d0a7f` 的真实 M11 composition、固定资源和 ABI146 私有 SQLite 依赖，只增加本组来源/并发门闩/观察计数。271个实际编译源码模块和228个依赖输入均留哈希；实际编译源码恢复快照在 `source-snapshot/`。实际245项资源逐SHA匹配。没有读取活动源码或重打 App。

- host.cjs：`1c33e915bf31b1ea74870de3b0a29daa02a1ae04593d7652f397289b3e7224ec`
- host.source.ts：`a99402086afc6bc48b64109478a34c722a17e665d14d9dfe3fa439b7bbcdecdb`
- run.mjs：`4558c8e3df7475e8ef5caa23589a26caeb773d1c8643e587ba6e3506a5da217f`
- static-preflight.json：`1dc281ea3997a42db341e0980011820b55f1f949f139269af0e96b6535b37e40`
- Electron42.11.14：`d9a9add305ad5300278ae01231bc109a0a3468117653fbdf0971a5a2db63004c`
- Helper .4：`7a009d321491f0645a3c2526639490f624a7b6af967f325add9490c0c274876f`
- 实际 runtime SOURCE：`db70a8ec3d28919c7bf9ba1ff300c570838aa35f482c48bf39af5ffad940759a`
- native CLI：`2da7c2b4161cd14ebaaa490f9ad67788a5e5b080dead8e87ff75ef13ba55ea1b`
- identity：`8599b53719c8f6fe2239a7e0bfc88b82e58084fdf50defb4166cfedfddd8ee10`

M11 使用真实 ResourceStore、BundleSource、Session/RunRegistry、ApplicationService/Module/ToolService 和 Gateway；实际受管 Python 根 fork 固定 CLI，真实 MacUnixPeerIdentityReader 核对可执行文件/UID/祖先。不是假 peer/FixtureProcessReader。token仅在私有进程内存与stdio传递，不落盘/argv/日志。原生根真正 exit0 后才 run.cli.exited。

## 注入与系统边界

只有来源 keyProvider 由合成密钥替代，并在第一次取密钥处有界暂停，第二次调用将抛错；没有执行真实 security/OS钥匙串。生产 journal 组件使用独立 AES-256-GCM cipher 构造注入，随机密钥只在内存，非 OS safeStorage 验收。生产 NativeStore/事务/日志实现和结果未替换。

NativeStore.prototype set/remove 的包装只记录进入/退出/计数并委托同一原方法，收尾恢复；没有改变权限、返回值或结果。前置 seed 使用实际 Session API，不属于被验收导入。

app activationPolicy=prohibited；生产 park 透明 opacity0、focusable=false、showInactive，未取得焦点、无桌面输入/PTY；使用 mock-keychain 仅为本次私有 Electron 分区。一个私有 HTTP 夹具服务，无外站/DNS访问/日常 profile 或真实凭据。Cookie URL 仅用于 CDP Cookie 查询，不导航到 qa/google/youtube 外网。

## 实际执行与清场

精确命令：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p045-executor-001/cache node /private/tmp/willyou-m12-p045-executor-001/run.mjs --execute
```

只执行一次，原 session39091 exit0；业务及原始清场12秒，2026-11-04 07:54:32.188Z 至07:54:44.159Z。driver22395、host22397、受管根22452；run `a3b04f68-61ff-445d-861a-cecbe613162f`，task `171f3962-c742-44f0-b28b-1ba1647cf828`，page `3299c31b-e051-4812-b538-5e3b91d1576d`。

8项清场全部 fulfilled：完成本次已运行导入/释放门闩/恢复hook；关闭真实Gateway；停止受管根并等真实exit；停止已结束run；dispose真实browser页面/Helper/代理/park；dispose applications；dispose runs；销毁所有WC/debugger。真实will-quit已留存，App正常exit0/signal=null，无强制终止。3个WC全部destroyed/debugger未附着、windows0、allRemaining空；本机HTTP服务关闭。

独立 `verify-cleanup.mjs` 核16个精确PID全部absent：

`22395,22397,22400,22401,22452,22469,22599,22557,22558,22724,22731,22744,22753,22778,22786,22802`

数字端口54221、54238全部closed；Helper `/private/tmp/wy-ab-c6f0e0898e0b965780652524` 无pid/sock/stream；私有TMP无M11 gateway目录或Unix socket。收尾见 `cleanup.json` 与 `unix-socket-final.json`。执行资源已明确交回协调者，之后只有静态归档。

## 保留的夹具错误与边界

`preparation-failure-001.json`：合成源 Cookie 表15列而INSERT写16占位符，被静态预检阻止，native和监听均未启动；修正15占位符后新编译及全预检通过。没有业务红被重跑掩盖。

`metadata-erratum.json`：原driver.raw.scope继承了P039的“T075”人类标签，原始文件保持不改；实际group/case、操作、并发结果及独立判定均是T082。本组没有运行clone矩阵，该标签不参与判定。

同一勘误还记录host观察数组引用边界：host聚合JSON中atKeyGate/secondBefore/secondAfter的nativeTrace保留了同一数组引用，最终保存时包含之后追加的7项，并非那一刻的冻结快照。driver经真实IPC即时序列化的对应观察均为0，独立判定使用这些原始IPC结果；原完整trace在host.nativeTrace。没有改动原raw。

本轮没有验证坏来源/中途写失败/跨进程恢复矩阵、真正UI确认或OS钥匙串，不能借此计其他用例。runtime-001已存在会拒绝重放；以后如有新输入须新attempt/冻结与资源租约。
