# App027/source031 S6 原01–06输入已绑定，等待Root完整租约

当前仅文件准备/实际新包只读身份绑定，无包装器/Native/App/OS/CLI/HTTP/Node/compiler或模型执行。原T140/T143已通过，本轮只更新当前包证据，正式新增0；生产/公共账不改。原App026流程直接复用，业务与路径suffix判断不变。

实际 source031清单 bf3af451b853283bdbc229cbf46bbff041bd644db850d8db3f82b6ac7348f293（3688文件）；官方 result3fabcb5bbf0a6ceb094fd6664363c088b9d2290212063c0871413a0d19363069。实际App027的176关键文件已按字节/mode登记。ASAR8cacf6c30aea4791b6f79940f1352918d75f517d22cea40ebd27aaf29d0d1093，exe ad6faa66e930e2f323968491347644be1d41dde0a7db78c43431e0b210ab935e；CLI/identity/agent/helper pins均从实际新包读取，非旧包冒充。显式Electron42.11.14已只读Info.plist核对，原browser package metadata原样匹配。此处绑定不是新安装通过。

原binder首次纯文件读取在sourceManifestSha256旧字段KeyError，发生于Appplist/176读取前，无Native操作；错误、旧binder、旧pendingmanifest在binding-schema-review-001保留。按Root明确要求使用独立official-build-input-adapter.json，记录原result与投影两边SHA/字段来源：新sourceManifestSHA256映射旧字段，sourceShaModeBeforeAfterMatched同原字段，native6取实际官方buildlog唯一JSON行284；额外CLI/helper只从实际文件派生，未改原result。source031不含旧inventory，source031-inventory.projection.json独立从030/031 files+modes派生7changed+2added，不修改source031。安装后完整payload/native6/原normalstartup3CLI/8judge要求全部保留。

原01–06顺序：01私有prepackaged复制+可信旧DMG缓存复制；02显式Electron42.11.14 electron-builder --prepackaged --mac dmg --arm64 --publish never；03原candidateJSON预期路径复制；04两own readonlymount，input=DMG=installed全部bytes/mode/symlink及size inventories后detach；05实际installed签名/helper/六原生；06只用本root实际安装/native输出绑定startup pin。原186startup静态输入随副本保留，只为06之后Root另行review；本次不执行07–09。

目录形状已修正：**Installed Applications、mounts/baseline、mounts/candidate、installer-input/WillYou.app、installer-output-002必须不存在**，不预建真实安装或挂载子目标。只建原脚本所需空parent（mounts、installer-input、baseline-download/stored-auth-attempt-002、cache、evidence/attempt-002）。run-first-six新增纯文件形状准入，正是原mkdir(exist_okFalse)前置，不放宽任何业务。原026预建空Install目录导致的FileExistsError历史不改。

Root复核当前execution-ready.json、prepared-inputs.json、input-binding-receipt和wrapper hash后，授完整包装/挂载/安装/Native/OS短租约，才可执行原前六阶段一次：

```sh
WILLYOU_P127_ROOT_LEASE=Root-App027-exclusive WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-app027-installer-001/cache /usr/bin/python3 /private/tmp/willyou-m12-app027-installer-001/run-first-six.py
```

任一阶段失败停止依赖项、保留原stdout/stderr/准确PID，不因工具观察超时重启。不得现在直接执行，也不借Root其他组Native。source/包不重建、不发布，不替换日常/Applications或触日常数据；0DeveloperID/notarization/x64/release。

阶段06之前 installed-startup-001/pin.json.finalReady=false，buildGate/nativeGate SHA=null；06必须真实产生并核验本轮output后才能转true。07实际installedApp/3stockCLI/normal0/null/signals[]、08独立cleanup（必须env WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1和--verify）、09原8judge及最终包装PID/ownmount/installedAppPrefix全清，仍需Root审安装pin后单独衔接，不用旧App026绿替代。最终资源核查入口与原9条完整展开命令在execution-ready.json；本轮只准备01–06。

本安装流程沿原initialFocusRequired=false，无键盘/前台输入，不声称系统/视觉/真实UI通过。App027renderer已因正式header修复变化，不能沿用旧321renderer字节相同声明；当前source/包pin明确区分。T145真正AppA和F12/F17真实UI仍按独立组原前置，不被S6替代。
