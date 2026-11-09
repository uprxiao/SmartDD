# T130 原 F12/F17 App026 A，共用单实例准备

当前仅静态准备，未启动 App/Native/HTTP、未收集测试、未编译、未读认证或系统前台。执行须 Root 新的完整资源租约且桌面实际可用；实际锁屏或原焦点条件不满足则延后，不向休息用户发送解锁或授权问题。本组无需模型/CLI登录/真实图片/Office/Keychain/系统剪贴板。

依据及完整原合同见 `original-contract.json`。原 M9 F12/F17 的 I 与 A 分层保留，本批只补真实当前 A，不重复已绿 I，不计整条 T130 或其他64映射通过。原 generic static-viewers/viewer-navigation driver 只参考原普通文件真实打开与源码往返，不跑其其他格式；专用 raster-ui/csv-acceptance-ui 的全部18图/5CSV/60格判据移植且原源码保存在 original-drivers。坏图比原旧驱动多一次真实重试点击，不能以自然尺寸或DOM存在替代完整判定。

App026/source030 固定实际已构建包，详 pin.json；renderer-equivalence.json 是纯ASAR文件提取所核 App025→026 的321个相同路径文件逐字节相同。原生 willyou-files、watcher、SQLite、Framework、exe、ASAR分别精确当前pin，不能用renderer等价冒充旧原生/App验收。

执行路径：只RPC准备一个项目/23个原合成夹具，确认任务0；所有前置齐后一次reload；给本次唯一窗口固定 `[A] T130 F12/F17 App026 文件预览`；仅一次既有授权精确PID初激，然后被动真实Native+DOM连续3秒；只装一个guard。项目编辑/文件区/筛选框/搜索结果均真实UI点击，23次打开均实际UI，无 files.open/store/DOM值改写。坏图8种均实际点一次重新加载并明确错误；真实GIF16帧合成器截图需红/绿帧；PNG解码alpha0/255。CSV实际点A1后原生键盘遍历60格，完整grid多行文本与只读单行值栏分核；源模式读CodeMirror完整文档模型，原字节/stat另核；无任何复制、保存、写回宣称。逐文件必要PNG和GIF16个1px原PNG保留。

目录形状：`fixtures/project`恰23个冻结原文件，`cache`为本组私有；**runtime-001、execution-started.json、raw.json、live.json必须不存在**。新 userData/home/tmp/work 仅执行时创建；不预建安装目录或运行目录。lease.receipt.json仅Root生成，不复制旧租约。原fixtures按SHA复用，不运行编码器/ffprobe/下载。

Root租约字段沿permit原结构：coordinator=root、status=granted、privateRoot为本根、executable=pin.executable、authorizationScope=`M12-T130-F12-F17-App-A`、foregroundState=`unlocked-and-available`、executionReadySHA256为execution-ready.json实际SHA，notBefore/expiresAt有效、revoked=false；resources至少Native/UI/App/PTY/HTTP/TCP/Unix/OS。独占UI和原生进程直到独立清场确认释放。

未来在完整租约后以 require_escalated 执行一次（当前禁止运行）：

```sh
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/run.mjs --execute
```

运行结束后独立精确清场，再原判定（不因run失败省略cleanup）：

```sh
env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/cleanup.mjs --verify
env WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t130-F12-F17-App026-A-prep-001/judge.mjs
```

异常保存完整私有stack/截图/只读DOM；失焦时只调用已授权JXA读取当时前台name/PID一次诊断，不放松guard、不rearm、不自动抢回前台。正常退出要求实际code0/null/signals[]；quit未确认保留unknown并按原self-owned harness准确收尾，不造normal。独立cleanup核本次准确PID、TCP、Unix、helper全clear。失败不盲重跑，先交原证据。

`static-review.json`仅AST/字节核对；没有运行driver/helper body或DOM。`driver-file-access-map.json`区分冻结静态读取、Root租约、未来输出。原18图与5CSV内容均逐原来源SHA匹配。公开交付只投影必要合成截图/结果/代码/哈希，不含App、DB、完整runtime、调试端点、认证。
