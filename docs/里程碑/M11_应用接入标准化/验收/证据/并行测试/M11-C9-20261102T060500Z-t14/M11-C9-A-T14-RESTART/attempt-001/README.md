# M11-C9-A-T14-RESTART attempt-001

T14（R09／R10／R12，层级 I＋A＋R）真实 A／R 补验：**受管运行中经原生退出 → 重启 → 侧栏恢复 → 真实 Codex CLI 续查 → 外部无身份 CLI 被拒**。

- 时间：2026-11-02 06:03（UTC 2026-11-01T22:03）
- 机器：macOS arm64；包：`/private/tmp/willyou-m11-s7/package-c7-attempt-001/mac-arm64/WillYou.app`，`app.asar` SHA256 `b87809c74aa2e4d9750710a053af71b9b96dd6f355790db3879384d18bd39b42`
- 源码清单：`42e08ed9d1915a8d357e37349fcc456ea5d0e9e2d7b92c9b589e137f8866a5b9`；驱动：冻结副本 `m11-zen-cli-ui.mjs`（`WILLYOU_M11_ZEN_MODE=app-restart`）
- Codex：`0.166.0`（`39acf979729dd290f9a24ee38b2914e036c91b65952872e28ae2a6b88a7db7c1`）
- 隔离根：`/private/tmp/willyou-m11-s7-native-IllpwN`（本次独立 userData／HOME／CODEX_HOME／项目）

## 退出动作（本次补验的核心）

由 `scripts/applications/fixtures/native-quit-performer.swift` 通过辅助功能（AX）完成，**不发送信号、不注入合成指针事件**：

1. `CGWindowList` 以标题标记 `A · M11 NORMAL QUIT · IllpwN` 定位本次 App 窗口与 PID；
2. `NSRunningApplication.activate` 激活 App（未激活时 `AXWindows` 为空，这是前几轮找不到确认框的原因）；
3. `kAXMenuBarAttribute` → 应用菜单 → 菜单项 `退出 WillYou`（`kAXPressAction`）；
4. 在 `kAXWindowsAttribute` 中找到独立窗口 `AXDialog`（**它不是 app 元素的子节点**），按 `退出`；
5. 轮询 `NSRunningApplication.isTerminated` 直到进程真正结束。

`quit-receipt.json` 记录：`ok=true`、`confirmationDialogText="有 1 个任务正在运行 | 退出 WillYou 会结束这些终端进程。重新打开后可在侧栏中点任务恢复（resume）。"`、`confirmationPressResult=0`、`processExited=true`、`signalsSent=false`、`syntheticPointerEvents=false`。

## 驱动结果（8 项）

`result.json` `status=passed-normal-app-restart`，8 项检查全绿，其中与本条直接相关：

- `normalExit`：PID 67225，`code 0`，无信号；`originalCliGone=true`；`oldRunAfterNormalQuit` = `stopped`／`revoked`（`ended_at 2026-11-01T22:03:31.349Z`）
- 重开后 `afterAppPid=67416`，同 `nativeId 01a19923-…`、`ptyId` 由 `ad6c870f…` 变为 `03839919…`、指针哈希保持 `1550d2f2…`（原 snapshot 未变）
- 恢复由真实侧栏选择触发；新 run `89f693d6…` 状态 `succeeded`，用原命名权限档完成真实禅道 CLI 读（`origin=cli`，`effectState=read-only`）
- 外部无身份 CLI：`AUTH_REQUIRED`（`layer=auth`，`effectState=not-started`，`retryable=false`，退出码 3）
- 受管 Codex 的 base 配置 `baseUnchanged=true`；具名档仅由真实 TUI 自身改写且业务字段保留

## 前几轮的失败与定位（未计入业务失败）

| 轮次 | 现象 | 原因 |
| --- | --- | --- |
| v1 | `error opening input file` | 执行器用相对路径，cwd 是冻结源码副本；`set -e` 提前中断 |
| v2 | `quit-item-not-pressed` | 按到了 Apple 菜单（菜单栏第 1 项是应用菜单，须按名称匹配） |
| v3 | `marker-window-not-found`／确认框未出现 | App 未激活时 `AXWindows` 为空；确认框须从 `kAXWindowsAttribute` 取 |
| v4 | 通过 | 加入激活＋`AXDialog` 扫描＋进程退出轮询 |

前几轮的 `driver.log`／`performer.log` 已被 v5 覆盖，未留存；上述结论来自当轮 `performer.log` 的 `reason` 字段。

## 说明

`result.json` 中 `normalQuitTrigger` 文案为“native Cmd+Q and own running-task confirmation; performed externally by coordinator CUA after this checkpoint”，来自冻结副本驱动；该动作实际由上述 AX 执行器完成（外部原生 CUA，非页面内操作）。仓库内驱动同字段已改为“AX menu quit + confirmation dialog by external native performer”，机制未变，生产输入未变。

## 文件

- `result.json`／`driver.log`／`performer.log`／`quit-receipt.json`：本轮结果与退出回执
- `before-normal-quit.png`：运行中、退出前
- `s8-run-plan-before-restart.png`：S8 运行计划（重启前）
- `after-normal-restart-read.png`：重启并从侧栏恢复后的真实 CLI 读
- `terminal-current.txt`／`electron.txt`／`electron-before-normal-quit.txt`：终端与 Electron 事实
- `manifest.json`：文件哈希（不含自身）
