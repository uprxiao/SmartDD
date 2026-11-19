# A76 真实待办的部分验收

2026-11-19，macOS arm64，隔离包 9a6e95cdc。

- 355：真实 Claude 2.1.326 的托管供应商请求没有公布 TaskCreate、TaskUpdate 或 TodoWrite。该驱动启动隔离 App 时的凭据过滤会清除全部 CLAUDE_CODE_ 前缀变量，传入的两项工具开关实际未生效。第 355 次覆盖默认工具公告。中继按预检在外部请求前终止，保留能力缺项和 App 正常退出。具备结构化任务工具的 Claude 正向仍待验。[结果](attempt-355/result.json)
- 356：真实 Codex 对同类合成待办发出一个实际 DeepSeek 请求，HTTP 200。请求没有公布任务清单工具，回答中有三项 Markdown 复选列表，真实时间线显示普通回答。SQLite 与 App 页面没有生成待办卡。App 退出 0，原生退出已核。[界面](attempt-356/01-todo-verdict.png) · [结果](attempt-356/result.json) · [进程](attempt-356/verified-release.json)

结构化正向和纯文本负向按各自记录继续取证，正式 A76 保持未通过。
