# M12-P039 / M12-T075 完整真实 CLI I 交付

结论：**原 M12-T075 全合同通过，19/19判据绿。** 本轮执行33次真实原生CLI，经真实M11认证/运行/工具/BrowserModule/BrowserService/SQLite；可将T075由部分通过归为完整I通过。没有改生产、公共账、Git或包。

## 最终输入

- 原P039002 1537输入清单SHA：`50fa9ac93ef2d962db608aaeedd53661523485468f2ac0f381c47cb729812606`，原279 SQL/打包能力资源补充SHA：`6a9ac48d930ad45f171aaac78532ae837a65baec8d834353ab2ef0ba295935a1`，均保留。
- 为补齐真实M11传递的legacy顶层静态资源，最终编译使用完整App012冻结 `/private/tmp/willyou-m12-p041-build-001/source`，Git `edfa6e9e48a40b206a954ce0ea1be1bae9afc2af`，2844输入manifest SHA `655abb9970e460ea64f424a6b9f5b9d3203d30412c11128c95509fda352166ab`。所有对应的实际导入生产源SHA与P039002一致。不是当前变更中的主树/out。
- 加入已冻241个capability-bundles资源后共3085源码/静态输入，执行后全部SHA仍相同。metafile实际271源码/静态模块、228依赖源，source-snapshot保存完整实际编译源；SQL/standardSkill/runtime glob均非空。
- compiled host：`a9d515f1e88fc9b2bf034decd2f7f353c13b780304cef8f82f6d9dc04951d1b0`；私有host源：`4e35f7e2da25ab4373b81ec8e118126a0a9afce13f2913d3550ce8742eeba0c9`；driver：`d2b667d848f8e6cce63a6ac91d86ec2d7fa695cb3c8a008a47a7b13237c23cdb`。
- 固定实际CLI `2da7c2b4161cd14ebaaa490f9ad67788a5e5b080dead8e87ff75ef13ba55ea1b`、Helper `7a009d321491f0645a3c2526639490f624a7b6af967f325add9490c0c274876f`、identity `8599b53719c8f6fe2239a7e0bfc88b82e58084fdf50defb4166cfedfddd8ee10`、运行SOURCE `db70a8ec3d28919c7bf9ba1ff300c570838aa35f482c48bf39af5ffad940759a`，0755/X_OK及官方runtime checker均核。SQLite12.11.1真实ABI146产物803376bb…为原私有只读副本。

## 原合同覆盖

实际私有SQL中P1/T1、T2，P2/T3完整存在；P1/P2各有项目profile，T2有未授权任务profile。T1项目profile先经真实CLI/本机HTTP站点具备session Cookie登录和localStorage token，主页面固定安全 `/app`，切profile不会重新访问自动登录URL来掩盖丢失。

完整实际序列：

- `tab profile list`：T1可见P1默认，不见P2及T2私有profile。
- `create`：返回task-owned T1 isolated profile。
- `clone` 已登录P1项目profile：返回新独立分区，owner确为T1，sourceProfileId为P1。
- `set` 到clone、`show`：同页面ID实际绑定clone，真实站点仍qa-source登录，local-source仍在。
- clone中POST登出并清localStorage，真实站点读回已登出；`use-default` 后来源仍qa-source/local-source。
- 额外反向：clone重新登录qa-clone/local-clone，来源登出后再切clone，仍qa-clone/local-clone，证明双向存储隔离。
- `delete` clone后其metadata从list消失，默认和手工创建profile仍在。
- `tab create --profile` 手工T1 profile，`show`确认为该profile。
- 使用真实P2 profile ID和未授权T2 profile ID，各执行`set`、`clone`、`delete`，共6个真实CLI负例，均 `SCOPE_DENIED`、exit2、无超时；所有list均不可见这两个profile，负例前后全profile metadata和页面绑定未改变。

所有被验收profile操作、切换、登录态/登出读回都经真正原生CLI，没有用direct invoke或直接BrowserService.execute代替。前置所有者/隐藏profile准备和只读观察是明示夹具。站点logout用于验证Cookie/localStorage浏览器隔离，不推论外站服务端集中撤销令牌的行为。

## 真实 M11 证据边界

实际安装固定browser package `eade338359724fa7cc85cd74e3a5e68fcd548e7f2d57b97ecb53dbbaad66708a`、runtime、Codex1.2.0 adapter，创建真实CapabilitySession/RunRegistry，授权Browser read/write，真实ApplicationToolService/AdapterRegistry/Module/BrowserService执行。

受管根是本次真实Python进程，不是模型或Agent R。它真实fork原生willyou-app，MacUnixPeerIdentityReader核对真实对端可执行文件、UID和祖先身份；没有FixtureProcessReader、伪peer或假Gateway。M11 token仅在宿主/受管根内存和私有stdio，不落盘、不放argv、不写日志。runRoot真实退出事件完成后才调用run.cli.exited，未把还活着的Electron自己伪记为已退出。

实际run `f8cf167e-88d8-4f82-b234-3885fb980014`，T1 `ff2f5a4b-5ed6-45aa-b757-cffad5272da8`；App11567、受管根11611。整个阶段约58秒，无业务重放、未知写自动重试或重复App构建。

## 系统边界与清场

本轮经协调者明确允许生产BrowserParkWindow实际透明opacity0、focusable=false、showInactive；app prohibited，不操作桌面输入，不声称零native窗口。观察的park没有焦点事件或可见不透明窗口。mock-keychain仅私有I前置，不是实际OS钥匙串验收。

实际7步清场全部fulfilled：关闭真实Gateway，停止受管根并等真实exit0，停止已结束run，dispose真实Browser页面/Helper/代理/park，dispose applications，dispose runs，最终缓存WC/debugger收尾。真实will-quit已同步留文件，App正常exit0/signal=null，没有forced stop。11个WC全部destroyed/debugger未附着，windows0/allRemaining空。

独立核48个精确自有PID均absent，清单在cleanup.json；其中包含App/受管根/33个原生CLI/Helper与实际子进程。9个实际数字端口全部closed：

`58165,58773,58930,59023,59065,59083,59099,59125,59148`

Helper当前及历史复用目录中的pid/sock/stream均无残留；私有TMP中M11 gateway目录与Unix socket均无残留，见unix-socket-final.json。root另独立核对48PID/9port/Helper文件全部退出。执行资源已明确交还，之后只有静态文件归档。

## 准备/后处理记录

原不完整冻结导致host顶层drizzle解析及M11 legacy标准Skill静态资源闭包缺项，均在native前截住；改用root提供的完整不可变App012输入并核drizzle0.32.2只读链接后一次完整metafile通过。原1537/279和准备失败记录保留，未以空glob放行。

独立清场verifier首次后台尚未写出cleanup.json时，judge提前读取发生ENOENT；继续观察原verifier完成后再运行原judge，得到19/19绿，没有重发任何native业务。记录在postprocessing-observation.json，原业务JSON和最终判定未据此改预期。

## 复现与归账

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p039-executor-001/cache node /private/tmp/willyou-m12-p039-executor-001/run.mjs --execute
```

runtime-001已存在会拒绝同根重放；后续新范围必须新attempt/根、统一冻结及资源租约。只建议T075原要求I整条通过；不增加T080/T081、App A或真实Agent R，也不宣称S5访问授权等尚未接入功能已验。
