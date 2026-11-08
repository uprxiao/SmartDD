# T145 App035 host 首批 20 槽

当前仅文件克隆已冻结且未执行的 A005 模板。source039 已按 Root SHA 核对，仅 workspace.css 复制原 P inline-code 样式，其余3688源/模式不变。App035 实际包/build/native6 pins 待 Root 交付，package-pin 状态显式pending，最终READY不存在。A005历史7项纯静态绿只作SHA复用依据，不冒称本根已执行。没有启动 Node、App、Native、OS、监听或模型。

本批仅运行原 1440×900 ×（light/dark）×（右区480/900）四组合，每组五原状态：空白启动页、空授权、默认登录态、设置常态、设置待重启。共20个全新 App035截图，不沿用 App032/033 图作当前。原57×8=456不删；1920×1200四组合对应20个host槽保留硬件缺项，其他416个槽待后续。

成熟流程保持：所有项目/AIprofile/任务前置先齐→一次reload→本次准确PID首次激活一次→真实Native+DOM稳定3秒→一个guard→真实UI导航/主题/480或900 resize→StoppedPanel真实启动绑定原PTY/PID/kernel/run。900宽必须实际按钮inside且centerOwned，不fit480。首失败完整私有stack/DOM/PNG后停止，不重试/rearm。

本次窄增量：B11使用原P全文；badge等当前page.profileId唯一匹配的元数据、已知scope文字、真实label title、UserRound12、aria-busy=false、原P placeholder与spellCheck=false后继续。B12通过真实badge点击进入管理；先保存当前Native placement，实际overlay park/真实capture，点“完成”，核同contents ID/URL恢复原main可见位置。RPC仅只读核对profile/snapshot，不用RPC打开管理。metadata新增实际margin/display/mini/badge/shadow变量，用来核六处已确认差异及badge/placeholder。

原八机械条件保留，额外完整核badge三段和20新图身份；机械绿不等于视觉通过。独立七类原图对照全部留空，实际截图后由Root审。图片原DPR/尺寸保存，不用emulation、拼图或修改图像制造一致。

实际App035绑定及必要短静态检查通过后，Root签完整Native/UI租约才可执行：

```sh
python3 /private/tmp/willyou-m12-t145-App038-host-renderer-A-007/root-run-with-awake.py
```

内层精确命令：

```sh
WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t145-App038-host-renderer-A-007/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t145-App038-host-renderer-A-007/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t145-App038-host-renderer-A-007/run.mjs --execute
```

无论run结果都独立执行：

```sh
WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t145-App038-host-renderer-A-007/cleanup-cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t145-App038-host-renderer-A-007/cleanup.mjs --verify
NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t145-App038-host-renderer-A-007/judge-cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t145-App038-host-renderer-A-007/judge.mjs
```

准入需要Node、真实App/PTY、loopbackHTTP/TCP/Unix、OS准确PID首次激活与清场的完整串行资源。外层仅已授权只读前台name/PID检查和临时600秒caffeinate；helper TERM/reap与App正常0/null/signals[]分别记录。实际锁屏/原焦点等前置不满足则留缺，用户休息不是禁测条件，也不向休息用户重问授权。

不得预建runtime-001、Native lease、raw/live、cleanup/judgement或截图。当前没有这些输出。无auth复制/日常数据/Keychain/剪贴板/模型/真实CLI业务。正式新增0，公共账由Root维护。
