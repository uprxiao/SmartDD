# A38／A42 语音入草稿（Claude Code，2026-11-20）

最终包 `15a8ea3ff`（`app.asar` `006dd741…9efe`，含 D06-80 修复），macOS arm64，Typeless 2.12.0（用户本机），隔离 HOME 中只放 Typeless 的两个听写快捷键字段（不复制其他 Typeless 设置）。用户在系统设置中为测试包授予辅助功能权限（重新打包后签名变化，又授予一次）。驱动见 [driver/](driver/)。

**第 580 次 4/4**：测试窗口前台、草稿“语音前半句。语音后半句。”光标在中间；用真实鼠标点 WillYou 输入框的麦克风按钮，WillYou 发出 Typeless“语音输入”快捷键（Right Option），用户说话后按 Right Option 结束。

| 判据 | 结果 |
| --- | --- |
| 真实 Typeless 转写插入光标处（结果“语音前半句。这是语音输入，这是语音后半句。”） | 通过 |
| 不自动发送（回合数 0），草稿持久化 | 通过 |
| 切到另一任务再回来草稿完整，另一任务无此文字 | 通过 |
| 智能体由 Claude 切到 Codex 后草稿完整且未发送 | 通过 |

## 缺陷 D06-80（已关闭）

Typeless 2.12 改了设置含义：`keyboardShortcut.pushToTalk` 现为“语音输入”（按一下开始、再按停止），`handlesFreeMode` 存的是“随便问”（Fn+Space）。WillYou 仍按 M7 规则取 `handlesFreeMode`，语音按钮因此唤起“随便问”问答模式（569 用户截图“回答”、575 截图“询问任何问题”）。用户确认修自动识别：Typeless ≥ 2.12.0 只取 `pushToTalk` 作听写、不再把 `handlesFreeMode` 当听写，更早版本保持 M7 规则；版本从 Typeless 安装包 Info.plist 读取。修复 `15a8ea3ff`，单元测试红绿，580 实包确认。

## 排查过程（保留）

568：驱动变量重名（未触发）。569：语音进了 Typeless“回答”模式。570、571：用系统脚本模拟 Typeless“粘贴上一次转写”的快捷键，TextEdit 对照同样无效，此诊断方法不成立。572：用户亲手点麦克风，仍进问答模式。574：辅助功能诊断发现测试驱动的页面尺寸模拟（`setDeviceMetricsOverride`）使真实点击与系统焦点落在网页区域（`AXWebArea`），取消模拟后焦点为输入框（`AXTextArea`）——这是测试环境问题，此后语音驱动不再使用尺寸模拟。575：焦点正确后仍是“询问任何问题”，用户截图 Typeless 设置揭示 D06-80。

## 范围说明

A38 的文件编辑、引用、切任务／供应商保留未保存编辑、保存冲突、邮件结果插入沿用此前实包证据（执行账 A38 所列 101、160 等）；A42 的 DB／SSH、引用、导入导出见第 535 次（[A42 自主部分](../../ca4aae05b/A42-db-ssh-transfer/README.md)）。
