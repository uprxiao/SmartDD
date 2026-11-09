App026/source030 S6 当前安装候选补证，**已准备、身份未绑定、不可开跑**。正式新增 0，沿原 T140/T143 已通过范围更新当前包证据，不增加用例或层级。

当前 `binding.json.ready=false`，全部 176 个关键文件 hash、source030 hash/count/path 都是显式 pending；`pin.json` 与 `pin.template.json` 的 finalReady=false，安装/Native gate SHA=null。没有读取尚未构建的 App026，没有把 App025 的当前身份填入026。所有原 OS 能力 Python 入口先过新 file-only binding_guard，直接启动也会在任何 OS 操作前停止；实际启动 driver 也先读取绑定回执。原九阶段业务和八项 judge 保留，改变仅 root/App版本标识/未来实际 pins，以及这些启动前 gate。

静态输入来自 App025 execution-ready 的 186 个 startup 冻结文件/依赖、原顶层八脚本与配置。没有复制旧 App、DMG、安装目录内容、runtime、DB、auth、lease 或实际执行结果。继承的 preparation/static-control JSON 只是原冻结输入，旧时间与来源在 lineage 可查，不算 App026 新绿。无 Native/App/CLI/HTTP/OS/模型或测试执行。

Root 正式构建 source030/App026 完成后，先审 build result、真实 native6、源码前后 hash/mode 和当前资源释放，再执行下面**只读新包＋写本私有输入的绑定器**（SHA 必须 Root 实际重算，不使用示例值）：

```sh
WILLYOU_APP026_INPUT_BINDING_CONFIRMED=1 /usr/bin/python3 /private/tmp/willyou-m12-app026-installer-001/bind-App026-inputs.py --execute --source-manifest /private/tmp/willyou-m12-t091-source-030/source-inputs.json --source-sha '<actual source030 manifest SHA256>' --build-result /private/tmp/willyou-m12-t091-App026-build-001/result.json --build-sha '<actual official result SHA256>'
```

如 Root 最终 source030/build 证据根不同，准确传入实际路径；binder 仍固定 actualApp 必须是 package026/mac-arm64/WillYou.app，实际包 pins 必须与官方 result 匹配。它只读文件/Info.plist，不运行任何 helper/CLI/App。它检查原显式 Electron42.11.14 与实际 CFBundleVersion、browser 包原始 metadata 完全相同；若不同即停交 Root 判断，不把当前实现反推成新 expected。会重算全部 176 关键文件 SHA/size/mode、source030 个数与关键构建配置，刷新 startup/outer READY 与 prepared inputs，产生 input-binding-receipt.json / bound-input-manifest.json。原 manifest.json 保留为本次 pending 准备冻结记录。

绑定只是**当前输入就绪**；installed pin 仍 false。Root 必须核 binding receipt、新 outer READY SHA、prepared SHA 与启动前所有原 frozen 输入后，才授完整包装/挂载/安装/Native/App/PTY/HTTP/OS短租约。前六阶段命令：

```sh
WILLYOU_P127_ROOT_LEASE=Root-App026-exclusive WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-app026-installer-001/cache /usr/bin/python3 /private/tmp/willyou-m12-app026-installer-001/run-first-six.py
```

原顺序固定：01私有 prepackaged 输入/可信旧DMG基线复制；02显式 Electron42.11.14 正式 electron-builder prepackaged DMG/publish never；03 candidate JSON gate 路径复制；04 readonly own mounts＋input=DMG=installed完整 bytes/mode/symlink＋两份大小 inventory/逐文件增量并 detach；05实际 installed 签名/helper与原六原生；06用本 root 实际安装/native输出绑定 startup pin。任一失败停止后续、保留原输出与准确 PID，不盲重跑。九条精确展开命令见 execution-ready.json；绑定后只有 prepared SHA 被本轮实际值替换，其他业务参数保持。

06形成 actual installed pin 后，Root 再核新的 installed-startup READY SHA，方能执行07。原 App025 8/8 与正常退出不替代026。后段准确命令：

```sh
WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-app026-installer-001/installed-startup-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-app026-installer-001/installed-startup-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-app026-installer-001/installed-startup-001/run.mjs --execute
WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-app026-installer-001/installed-startup-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-app026-installer-001/installed-startup-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-app026-installer-001/installed-startup-001/cleanup.mjs --verify
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-app026-installer-001/installed-startup-001/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-app026-installer-001/installed-startup-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-app026-installer-001/installed-startup-001/judge.mjs
/usr/bin/python3 /private/tmp/willyou-m12-app026-installer-001/check-final-resources.py
/usr/bin/python3 /private/tmp/willyou-m12-app026-installer-001/recheck-size.py
```

三条 stockCLI 仍是原 identity / create / snapshot，各自真实数字0；合成 caller/fixture，0 OpenAI/auth/model；App实际 execPath/resources/userData/DOM 与正常0/null/signals[]均须原事实。正常退出与独立清理分开。原 cleanup 必须 `WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1` + `--verify`，核自己所有 recorded PID/TCP/Unix/helper；最终包装阶段 PID、owned mounts、installedApp prefix 都须准确全清才释放。Root 独立核大小账，compressed DMG不冒充uncompressed kernel体积。旧 P125 命令遗漏历史引用保留于原025 lineage，不能改旧红。

S6 此组不需要前台键盘输入，原 initialFocusRequired=false；不因此声称系统/视觉/焦点通过。用户睡觉时不主动激活、不模拟用户确认，也不将本组安装 I 当 T091 真实 UI/R。0 DeveloperID/notarization/x64/release/publish，原包/日常安装/数据不变。
