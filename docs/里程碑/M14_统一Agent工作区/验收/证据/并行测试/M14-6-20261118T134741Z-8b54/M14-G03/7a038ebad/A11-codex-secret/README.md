# A11 原生多字段表单与保密字段

2026-11-19，macOS arm64。冻结候选 `7a038ebad2f4c45112799bf61e16caf2ff395b06`，ASAR `9aaaa71f2efd434faf4cc4e36bdd6d08844b3b137429b8672a572e96d99b58ab`。真实 Codex CLI 0.169.0 与打包 App，隔离 HOME／userData，后台 CDP；模型响应走本机合成服务。根任务的测试配置显式启用 Codex 的 `default_mode_request_user_input` 功能，原生进程生成请求并接收回答。

- 第 384 次受工具沙箱的本机监听限制，第 385 次修正 Codex 要求每道题均有选项，第 386 次确认实际发出了 `isSecret`，并修正驱动选中第一个单选框而非密码输入框的问题。三次结果均留在同目录。
- [387 旧包反例](attempt-387/result.json)：真实三字段表单，UI 以密码输入框遮挡，真实执行器收到三道题的准确回答。合成秘密出现在 WillYou SQLite 和 Codex 原生会话文件；App 日志未检出。
- [389 新包复验](attempt-389/result.json)：实际提交选择、普通文本和密码三项，根任务收到原生 `requestUserInput` 并返回完整结果，页面未显示明文。退出后扫描整个隔离 userData 与 HOME 共 446 个文件；WillYou 日志与数据库无明文，唯一命中在 Codex 原生 rollout。App 正常退出，无渲染异常。
- 2026-11-19 用户确认保密判据以 WillYou 自有日志和数据库为范围，Codex 原生会话的留存单独登记。未归档原生会话文件或数据库，仅保留合成值命中位置、断言、App 日志和遮挡截图。

[三字段表单](attempt-389/01-native-multifield.png) · [保密字段遮挡](attempt-389/02-masked-filled.png) · [完成](attempt-389/03-native-completed.png) · [第 380 次其他判据](../../0ee3d5c31/A11-request-panel/README.md)

[驱动](driver/a11-codex-form.mjs) 基于同轮次私有候选目录 `g03/prep-next/a11-codex-form`。复跑时使用该目录结构和已核对的候选提交与 ASAR；归档配套公共驱动用于重建取证。
