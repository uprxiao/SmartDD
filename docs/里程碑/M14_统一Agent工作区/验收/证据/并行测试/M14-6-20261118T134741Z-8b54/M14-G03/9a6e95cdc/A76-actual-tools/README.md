# A76 真实结构化待办

2026-11-19，macOS arm64，隔离包 9a6e95cdc。

- 355：真实 Claude 2.1.326 的托管供应商请求没有公布 TaskCreate、TaskUpdate 或 TodoWrite。该驱动启动隔离 App 时的凭据过滤会清除全部 CLAUDE_CODE_ 前缀变量，传入的两项工具开关实际未生效。第 355 次覆盖默认工具公告。中继按预检在外部请求前终止，保留能力缺项和 App 正常退出。结构化工具实际启用的正向见 362。[结果](attempt-355/result.json)
- 356：真实 Codex 对同类合成待办发出一个实际 DeepSeek 请求，HTTP 200。请求没有公布任务清单工具，回答中有三项 Markdown 复选列表，真实时间线显示普通回答。SQLite 与 App 页面没有生成待办卡。App 退出 0，原生退出已核。[界面](attempt-356/01-todo-verdict.png) · [结果](attempt-356/result.json) · [进程](attempt-356/verified-release.json)

- 362：在独立 App 的凭据过滤后恢复两项原生待办环境开关，核对 App 和本次 Claude 2.1.326 进程均收到。原生启动参数未改动，真实公布 TaskCreate／TaskUpdate。DeepSeek 的 8 个实际请求均成功。模型真实调用 3 次创建、4 次更新，更新 ID 顺序为 2、1、2、3。7 个工具结果成功。应用只显示一张待办卡，记录进行中状态，最终 3/3。SQLite 保留唯一条目修订 7，工具执行未分散为工作组内的待办记录。App 退出 0，CLI 与桥均核对退出。[界面](attempt-362/01-todo-verdict.png) · [结果](attempt-362/result.json) · [冷态核验](attempt-362/verified-durable-todo-and-release.json)

已有实际录制回放及投影测试重新执行，15 项产品投影测试通过；录制回放汇总为一张三项待办，并通过失败结果保护断言。Claude 结构化正向、Codex 纯文本对照及各层证据均完成，A76 整条通过。[录制回放](attempt-362/new-recordings.log.gz) · [投影测试](attempt-362/timeline-test.log.gz) · [环境守卫预检](claude-env-driver/preflight.json)
