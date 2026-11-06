# T130 原映射 F12：单文件 Native I 准备

只准备原 `src/renderer/features/files/raster-acceptance.test.ts` 的1个原it，不跑原108套、已绿253/90/31/2/5或F17。原66映射F12的全部显示/尺寸/失败/动画合同保持；本组只补原文件自己声明的真实编码输入→FileService/RootLease/revision/chunk/Native broker字节I，不替代App renderer实际解码、alpha、动图、错误/重试或完整T130。

原18合成编码图和oracle已在M9公开归档找回，18逐SHA与原 `fixtures.json` 及归档index相同：8有效格式、8故意损坏、animated GIF、transparent PNG。oracle保留原字节（内含旧project路径只是来源，测试只读cases）；新测试项目明确指向本私有 `fixtures/project`，父目录oracle按原代码读取。原generator和ffprobe来源仅作已存来源证据，当前不运行FFmpeg/cwebp、不下载/新生fixture。旧Canvas drawImage动图误判不复用。

源固定source030完整3686项私有复制，原test字节不改；实际入口141runtime模块/15bare specifier分类，无未知dynamicimport。完整源复制只防止相对/worker/资源遗漏，不扩大测试include。第三方123包4360文件184链接从原已冻结共享依赖实际树复制，package/lock与source030精确相同，无install/download。Node固定v22.23.1 SHA，未执行版本探针。Vitest4.1.11只选原单文件，maxWorkers1/fileParallelismfalse/node环境，cache/tmp/home全私有，0skip才可判通过。

仅真实packaged App026 `native/willyou-files` SHA cbed256bf528b032f8a004252672d8a77d9f6403751380871f8dd16c6f26f736 进入原NativeFileBroker；不复用其它App/Native身份。@parcel/watcher为业务NAPI：私有binding明确换成当前App026原件855e6a77081bd6c2e7893545dcd6438fe8057f91a05d594cdc7d50f5008331e5，来源/旧新SHA独立记录，App本体不改。fsevents/Rollup/lightningcss是工具链NAPI，不要求与App等字节，也不能因为它们存在判业务红。actual load/ABI仍待原test，静态pin不写绿。better-sqlite3不在141runtime源码import graph，无SQLite运行/ABI成功断言；该子组不用数据库或真实OfficeGUI。

原test自带 `vi.mock('electron', factory)`不改；alias只把模块解析落到failclosed占位，原mock工厂必须截获，若实际加载该占位就抛错。没有App/DOM/前台替身冒充A。默认FileService未传Office/pages/worker配置，原步骤只open image/chunk/close，不调用OfficeEngine/外部打开/模型。

观察器仅本次Node进程：透明委托spawn/fork/execFile/kill/dlopen，记录真实PID/退出/信号/NAPI角色和SHA，不换stdout/结果/Native协议或参数。继承到本次Vitest worker，Native helper自己的原env不改；完整私有日志保留。钩子随自有Node进程退出结束，独立核PID、精确helper/privateesbuild出生范围及原mkdtemp目录清空；不操作日常或未知进程、不造端口/socket收据。读取业务Native输入与工具链NAPI分层，原断言不改。

阶段：静态准备已做18文件/原oracle/源/依赖/绑定核对，没有执行/收集test、Native、编译器或探针。无fixture生成/Swift编译阶段。未来Root完整Native/OS/compiler租约后，Vitest自身esbuild只转译本组选中输入；test成功也只算1项I及18观察，不折正式整条。`runtime-001`等运行目录不可预建。

执行（需Root新lease scope=M12-T130-F12-native-I，READY SHA精确绑定）：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-F12-native-prep-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-F12-native-prep-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t130-F12-native-prep-001/run.mjs --execute
```

原driver终态后、本组资源仍属本轮时独立清场：

```sh
env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-F12-native-prep-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-F12-native-prep-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t130-F12-native-prep-001/cleanup.mjs --verify
```

资源准确释放后纯文件判定：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-F12-native-prep-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-F12-native-prep-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t130-F12-native-prep-001/judge.mjs
```

不改生产/公共账，不宣称本组已执行或F12/App/T130整体已过。
