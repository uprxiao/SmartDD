# B09.5 只补真实60秒自动复位

原[第一、第二轮真实通过](../B09-voice-native-capture-cancel-partial/index.json)。新增 `--timeout-only`，保留真实前台观察；协调者发送本轮用户指令后写准确pid/title的启动标志。用户只保留测试窗前台，真实超时后按⌘B一次。额外只读观测隔离录制控件内约定的Esc／⌘B按键，无全局监听；提前结束时保存实际时长及状态。驱动 SHA `dfb005170d1ca9fe34c89aa3fd5f136d3733299aa54c4485dd05e039917dc52b`。脚本预检通过，实际结果另记。
