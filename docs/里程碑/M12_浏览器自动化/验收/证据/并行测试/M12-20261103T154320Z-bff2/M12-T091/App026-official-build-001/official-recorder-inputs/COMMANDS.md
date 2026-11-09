App026/source030 官方打包草案，当前仅文件准备；协调者完成实际回归、冻结最后源码并授予独占构建资源后才可执行。没有执行本文件中的命令。

1. Root 确认最终测试红/绿、源码差异以及实际 commit。`--delta` 必须是最后一份冻结的 T091 修改文件清单（当前 source002 审核后的两测试夹具已改变，不能用旧 source002 SHA 冒充最终输入）。保留原单元红。设置以下非秘密协调变量；FINAL 值须来自 Root 实际最终清单：

```sh
export WILLYOU_APP026_ROOT_EXCLUSIVE=1
export WILLYOU_APP026_REGRESSIONS_ACCEPTED=1
export T091_FINAL_DELTA_MANIFEST=/private/tmp/willyou-m12-t091-fix-001/source-before-unit-003.json
export T091_FINAL_DELTA_SHA='<Root重算最终清单SHA256>'
export T091_FINAL_COMMIT='<Root实际git rev-parse HEAD>'
```

`source-before-unit-003.json` 路径目前存在，但本执行者没有读取或认定它为最终；如 Root 再次冻结须准确改变量，不能静默选择最新文件。只有受验源码与最终清单完全一致、清单之外所有 source029 项 hash/mode 未变时，薄冻结器才复制。出现新增未声明变更应停止，Root 审核最终 delta 后另行处理，不删检查强行构建。

```sh
/usr/bin/python3 /private/tmp/willyou-m12-t091-App026-build-preparation-001/freeze-source030.py --execute --delta "$T091_FINAL_DELTA_MANIFEST" --delta-sha "$T091_FINAL_DELTA_SHA" --commit "$T091_FINAL_COMMIT"
```

冻结沿 source029 的 files/modes/实际副本 schema，保留原明确文件集合，合并最终 delta 新文件（包括 browser-project-defaults.ts 与测试）。它不遍历凭据或日常配置，不复制 node_modules、运行状态、缓存、App。未声明变化/缺失/符号链接立即停；原冻结目的地若存在也停，不覆盖历史。冻结器不重新构造产品或编译源包。

2. Root 核新的 source030 SHA 后执行官方打包。薄 recorder 先核工作树和冻结副本全部 SHA/mode，官方构建退出后再核同份输入；只调整实际 output/cache 路径，不改产品构建步骤：

```sh
/usr/bin/python3 /private/tmp/willyou-m12-t091-App026-build-preparation-001/build-App026.py --execute --source-sha '<Root实际source030清单SHA256>'
```

实际唯一官方业务命令（cwd `/Users/liubu/hx/4.uprxiao/SmartDD`）：

```sh
/Users/liubu/.hermes/node/bin/node scripts/release/build.mjs --dir --output-dir /private/tmp/willyou-m12-s2-package-026
```

这正是 App025 started.json 已执行命令的 output026 重绑。官方脚本依次核 installed Electron 平台/架构/版本，force rebuild better-sqlite3/node-pty，electron-vite build，正式 electron-builder `--mac --dir --arm64 --publish never`，最后用实际 App executable 运行原 native-smoke.cjs（六项）。不可用单独 vite、prepackaged 包装或手动复制旧 ASAR/CLI 替代。

`electron.vite.config.ts` writeBundle 已调用官方 `scripts/applications/build.mjs`，该脚本实际用 xcrun/clang++ 从当前 cli.mm 重编 `out/native/willyou-app`；electron-builder extraResources 复制并签名。无需额外先编 CLI 形成双份输入。新 provenance 记录 native CLI 源 hash、构建 recipe hash、out 编译件与包内签名后件各自 SHA；不要求签名前后字节相等。agent-browser 的既有 SOURCE.json 属于另一个 helper，不得将 stockCLI 新 SHA 写进那个声明。

薄 recorder 私有 cache 是 buildRoot/cache，输出是独立 package026；官方脚本原已受验的 repository out、browser build work、engine-cache 路径保持原方式，并受 Root 完整构建独占租约保护。不能宣称这些官方内部缓存因设置 XDG 就全部隔离。结果保留实际 started PID、日志、exit、source before/after、真实包 pins、唯一官方 native6 JSON。异常时先保留 stage/PID/原日志，不盲重启；Root 按准确记录独立核编译/包装/检查进程收尾，未核前不能称资源已释放。

3. 原 App025 另有实际 codesign verify 补证。App026 应在新包完成后真实重做：

```sh
/usr/bin/codesign --verify --deep --strict /private/tmp/willyou-m12-s2-package-026/mac-arm64/WillYou.app
```

Root 保存实际退出及新 pin，并核准确本轮构建进程/端口清场后才交 App 使用者。不得拿 App025 codesign 或 native6 结果改名。

4. S6 只沿已执行的 `/private/tmp/willyou-m12-app025-installer-001/execution-ready.json` 原九阶段，在新私有 `/private/tmp/willyou-m12-app026-installer-001` 重新冻结路径/pins。新 ASAR/exe/stockCLI/source030 来自实际 build result；以下是必须保留的阶段与入口，当前未复制/重绑成 S6 READY，不能执行旧脚本指向旧包：

- 原 `prepare-native-input.py --execute`：私有 App 输入与可信旧基线复制；逐项核当前 pins、独立 inode。
- 原 `build-installer-002.py --execute`：prepackaged 当前 App026 的完整正式 electron-builder DMG 包装；保留已实证显式 Electron 42.11.14 参数与 publish never，只有当前实际 Electron 仍匹配才沿用，不靠 package.json 范围猜版本。
- 原 candidate JSON 精确投影到 install gate 约定路径。
- 原 `install-and-compare.py --execute`：input→只读 DMG→私有 installed 全部文件 bytes/mode/symlink 对等，完整两份 inventory/逐文件 delta，精确 owned mounts detach。
- 原 `check-installed-native.py --execute`：实际 installed signature/version/架构/helper SHA 与原六原生。
- 原 `bind-installed-pins.py --execute`：必须在本轮真实安装/native 输出后才 finalReady=true；Root 重核 boundReady SHA。
- 原 installed-startup `run.mjs --execute`：实际 installed executable/resources/userData，真实三条 stockCLI identity/create/snapshot，正常退出。
- 原 `cleanup.mjs --verify`：必须含 `WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1`，独立准确 own PID/TCP/Unix/helper allClear；保留 P125 首次遗漏 env/--verify 的准备红作为历史，不再遗漏。
- 原 `judge.mjs` 八判据；随后原 `check-final-resources.py` 核 wrapper/phase PID、owned mount、installedApp prefix 全清。Root 独立重新加总大小账。

S6 当前仍待实际新包 pins 的独立 READY，不能直接执行 App025 的命令，也不能把旧 prepared pin / 静态 precheck 当新绿。T140/T143 原已通过；本次只更新受影响当前包证据，正式新增0。main 与 CLI 都改变：目录包官方 native6、签名/pins、DMG完整payload、installed native/startup、尺寸账必须新测；browser helper/资源、renderer、四其他 helpers 等只有逐份 byte+mode 证据相符才可复用其未受影响范围。T091 真 UI＋真实 R 仍须新包完整执行，不能以工程/安装绿计整条。

无 DeveloperID、notarization、x64、release/publish、真实账号读取或模型发送。无需为本草案申请新用户确认；实际资源与执行时机继续由 Root 统一调度。
