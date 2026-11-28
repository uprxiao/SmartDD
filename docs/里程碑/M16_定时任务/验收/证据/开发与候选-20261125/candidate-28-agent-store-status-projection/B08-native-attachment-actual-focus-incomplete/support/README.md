# M16 B08.1 原生附件另存恢复执行（C28）

私有执行支持目录。已归档 C24 原生项目保存的 harness 为起点，采用 C27 已实际验证的 native load 完成后再连接原可信 renderer 的启动顺序。C27 实际合成附件 UI 前置已通过，本轮重建同类闭库 fixture；全部四项真实 Native Save As 尚待实际执行。

## 执行

仅协调者在 B11 释放本地窗口资源后运行。工作目录为 SmartDD 根。预检已执行；如需再次核验：

```sh
node release/m16-qa-support/b08-recovery/preflight.mjs
```

实际运行必须提供固定 C28 bundle、asar/native/file broker 哈希，全等核对 C28 manifest。进程只连接本轮自己的 localhost 调试端口。

```sh
node release/m16-qa-support/b08-recovery/driver.mjs --coordinator-authorized-user-native \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app \
  5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e \
  5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080 \
  e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5
```

首条 JSON 给出本轮独立 root。`progress.json` 含逐步 handoff，`result.json` 持续记录实际结果，`native-dialog-observations.json` 保存原真实 OS Promise 返回及原 owner/shell，`front-observations.jsonl` 是独立 AppKit 前台样本，仅保留本轮 PID、Finder 或 other；不记录其他应用名称或路径。

## 同一个用户批次

只操作标题为 `WillYou · M16 B08附件另存 <本轮标识>` 的独立窗。Driver 自动打开合成草稿并真实点击附件保存按钮。用户本人操作四个系统保存框，具体保存目录以实时 handoff 为准。

1. `cancel-focused` 点击取消，留在 WillYou 前台。
2. `save-focused` 按 ⌘⇧G 进入 handoff 的 `directory`，保留 `M16-B08-binary.bin`，点击保存附件，留在 WillYou 前台。
3. `cancel-finder` 点击取消，随即切到 Finder、停留，等该项通过及下一步前台提示，再点回本轮 WillYou。
4. `save-finder` 按 ⌘⇧G 进入该项独立 `directory`，保留同名文件，点击保存附件并切到 Finder，停留直到最终提示。

若目录不匹配或系统要求覆盖，取消并报告。Driver 不会自动点系统对话框，不读取用户名、账号或真实文件。每项核原真实 owner、原生选择回执、App UI 回执、实际目标文件与哈希/取消无文件、保存回执数量及原壳 focus 调用。Finder 两项的包装器在真实原生返回已经产生后，只暂缓交付完全未修改的原返回值，独立实际 Finder 前台与原 owner unfocused 已核实才释放。受控真实回调时序独立记录；这两项不代表未经包装器的自然回调时序。无模拟页面焦点、系统输入、强制 App 激活。

首次运行可能需要本人先点本轮隔离窗口；所有后续受影响操作按实时 `progress.json` 前台提示。每条只提交一次真实 UI Save 点击；出现原生选择不符、未确认结果或启动错误时保留现场，停止依赖操作。最终核 clean exit、闭库完整性、1 份 synthetic draft/attachment/0 secrets/0 send；通过时只表示 B08.1 此四项。

## 预检覆盖

`preflight.json` 固定精确 bundle 及本地 helper 哈希、校验新私有路径与 macOS `/tmp` 别名，拒绝旧路径、越界、其他 case 路径和已存在文件。`node --check` 与原 `check-cdp-expressions.mjs` 检查通过。动态 JS 生成时再次编译表达式；实际 App、OS 和 closed DB fixture 由协调者运行核验。

四项默认同批执行，亦可把该命令末尾加 `--cases=cancel-focused,save-focused` 或 `--cases=cancel-finder,save-finder`（任选原合同中的单项或按原顺序子集）。每次新启动只产生独立 fixture 和新根，成功则仅统计所选项，合并多批时按四个原 case ID 去重。每项的本人等前台 240 秒、原生 OS 操作 300 秒、Finder 交接 220 秒；所有历史结果逐项落盘，原始合规 OS 返回对象原样保留。
