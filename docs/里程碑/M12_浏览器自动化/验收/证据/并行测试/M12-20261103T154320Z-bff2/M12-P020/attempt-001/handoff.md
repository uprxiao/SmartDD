# P020 / T086 attempt001 交付

依据 R1.3 / V1.2，执行原T086完整环境矩阵的首次真实 I：真实CLI/M11/BrowserService/gateway/SQLite/.4 helper与本机合成站点。结论：未通过，不能计T086完成。独立修正判定13项10绿，geo两个判据因夹具观察错误未完成，media reduce一项真实产品红。保留result.initial.json及原adjudicate.mjs四红首判，adjudicate-002.mjs/result.json仅修独立checker/分类，原始业务没有重发。

准确复现命令（新实例才可执行，当前原始目录已冻结勿重放）：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p020-executor-001/cache node /private/tmp/willyou-m12-p020-executor-001/run.mjs --execute
```

实际运行 2026-11-04T03:45:36.745Z 至 2026-11-04T03:46:02.625Z，22次真实CLI，全部stdout先落cli-*.raw.json再解析。host57473，数字端口50364/50372。

| 原判据 | 实际结果 |
| --- | --- |
| viewport desktop/mobile/scale | 912×684/DPR1.5与375×812/mobile=true/DPR2，实际window.s3Environment的innerWidth/innerHeight/DPR与CLI参数一致。desktop visualViewport.width897是滚动条占位，原checker额外要求等于912不属于原判据，已勘误；mobile visualViewport375×812仍严格核对。 |
| geolocation | CLI配置1.2345/2.3456/accuracy12成功，页面真实navigator请求已armed，但驱动读取workspace.permission；该字段只代表当前UI页，而CLI默认tab create按需求不激活，实际activeId=null。因此驱动没有正确观察目标页prompt，没有调用允许RPC，也没取得目标页坐标，属于未完成夹具分支，不能计产品通过或产品失败。 |
| set device | 固定.4源码提前定义iPhone14=390×844/DPR3/精确iPhoneOS16_0 UA；实际页面全一致。定义及完整source/proof见device-expected.json/device-actions.rs/device-prior-source-provenance.json。 |
| offline on/off | on后navigator.onLine=false，真实fetch失败且服务请求账无新增；off后online=true、真实HTTP200恢复并在服务账增加一次。 |
| headers | 两ASCII合成头在页面请求回显与实际server账均精确匹配。 |
| media | dark/reduce返回exit0，页面dark=true但reduced=false（产品红）；light/no-preference实际false/false。固定commands.rs2540-2554仅识别裸reduced-motion标记，宿主当前传--reduced-motion reduce，所以被忽略；静态原文与哈希已保留。 |

冻结1814源文件SHA入口8f9ef6159e0c74219abd73f232380259ca20a1ab6500cb6fed7933b0fc1d051c，279实际编译源快照/215依赖源SHA/112私有依赖/272真实资源；compiled-hoste21b219bae8e87b6c525515196ecbc45b720276dd9e91327b30918f4f64862ed；helper7a009d32。3个原生产物0755/X_OK与当前PID的真实identity预检通过，child exit0单列native-mode-preflight.json；静态预检nativeStarted:false指尚无被验收App/业务启动，不否认该原生诊断。

真实business close后host exit0，30个自有PID（包括daemon57564）逐项ps/lsof全absent，50364/50372两数字端口无监听；helper stopped/clientStopped/socketFilesRemoved均成立。Session、geo/viewport/device/media emulation都在本次私有进程/页面，真实dispose销毁并断开代理/helper，进程退出；无需触碰日常App。原生租约已明确释放。

后续建议仅在新补充冻结输入复验geo目标prompt/坐标与media翻译；green viewport/device/offline/headers等按实际来源和受影响函数哈希复用，勿重跑全矩阵。正确geo前置应直接读permissions.snapshot(taskId,本次pageId)，必要时显式I用户显示页面，核visibilityState；用户允许只经真实permissions.respond，不可Browser.grantPermissions，不把native硬件或App A计通过。当前没有启动新attempt。

静态第三方诊断源码来自协调者明确指向的immutable .4构建输入，逐文件SHA与P007005证明吻合，原MIT许可证一并device-helper-LICENSE保留；没有从活动src读取或修改生产。
