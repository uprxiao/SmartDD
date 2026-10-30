# TR · T67 本机 PostgreSQL 只读 SQL 隔离权限方案

依据 M10 R1.6＋§12.21、原 T67。2026-10-30 SG，**驱动已准备，用户本次许可尚未取得；未启动本批 App／PostgreSQL／原生 SQL**。不是原用例通过证据，不扩大原 SQL／SSH 或发件范围。

## 为什么需要本次许可

[原 MA 拒绝](../验收/MA_T67项目MCP只读修复与权限边界_20261026.md)证明原 read-only CLI 在追加必需审计时被拒。原数据库脚本同样先 `record_resource("attempted")`，再连接数据库，并记录 connected／completed；`--list` 提前返回，TO 的三次列表不证明 SQL。

[AGENTS.md](../../../../AGENTS.md)规定“既有工具拒绝和权限边界不能由 CDP 绕过”。[MB](../验收/MB_T67隔离SSH权限方案_20261027.md)许可覆盖当次固定 SSH，不作为本次数据库网络／审计权限的批准。生产默认、日常配置和既有拒绝保持。

## 可审阅的执行范围

| 项目 | 本次具体动作／边界 |
| --- | --- |
| App／CLI | 当前 TQ `.app` 完整路径启动，19 pin；ASAR `3423752128cea8f2dc5569bb279a32612a9c7d72d785a25abe735a5c384f7995`。固定 Codex 0.162.1，SHA `74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0` |
| 隔离数据 | 仅新建 `/private/tmp/willyou-m10-native-service-<随机>/` 的 userData、HOME、CODEX_HOME、cwd／项目、临时 PostgreSQL、随机 SCRAM 凭据。重启复用本批同一 userData，未知旧根／日常数据不参与 |
| 权限变化 | 本次新 AI 配置 `--sandbox workspace-write --ask-for-approval never`；workspace-write 包含本次隔离 cwd 及 CLI 默认临时目录。唯一**额外** `--add-dir` 为本次 `<userData>/capabilities/resource-audit`；同时显式配置 `sandbox_mode="workspace-write"`、`approval_policy="never"`、`sandbox_workspace_write.writable_roots=[<该审计目录>]`、`sandbox_workspace_write.network_access=true` |
| 网络实际范围 | 合成 Responses 和 PostgreSQL14 均仅绑定 `127.0.0.1` 随机端口。**网络开关本身不限回环**，不宣称 OS 强制白名单；确定性模型夹具只请求本次项目上下文、完整标准 Skill、原 DB 脚本及本地 M10 草稿读取 |
| 数据库 | 复用 TO 的自建 `wy_t67`／`wy_fixture.marker`。`wy_reader` 无 superuser／createdb／createrole／replication，只授予 CONNECT／USAGE／SELECT，默认 transaction_read_only=on；原投影同为 readonly，原脚本不传 `--allow-write` |
| SQL 及次数 | 新建、明确恢复、正常 App 重启后的同一 Task，各**一次**固定 SELECT，最多 3 次 native SQL 尝试。实际命令使用私有 Python3.11 `-I -B`、原投影 `db_query.py --db <本次UUID> --sql <下述固定语句> --format json --limit 1 --connect-timeout 2 --read-timeout 5`。原脚本逐字节核对，不改、禁用或绕开审计 |
| 原审计 | 原追加 attempted／connected／completed 各一次／阶段，预期总计 9 条；逐条核对项目／resourceId／配置 hash／127.0.0.1端口／库／schema／username。模型命令仍运行时只用原 session handle 等待，观察超时不重发 SQL |
| 其他业务 | 复用 TO 已通过的真实 DB 表单错误／成功／原生密文保存、项目入口 Task、新建／停止／恢复、原标准 Skill／项目 MCP／M10 草稿读取和重启卡片测试；本次不执行 SSH、SMTP、reply/import/send、生产业务资源或真实模型请求 |
| 停止与隐私 | 仅关闭本批已知 App／CLI／桥／PG；核对 run／lease／PID／库和原审计。随机密码、owner 文件、数据库目录和 HOME 不归档。若钥匙串需要用户操作则后置，不反复启动或长等；原未知桥／租约不清理 |

固定 SQL：

```sql
SELECT value,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_user AS username,
       current_database() AS database
FROM wy_fixture.marker
```

预期一行：`TO_T67_READ_ONLY_MARKER`、`on`、`wy_reader`、`wy_t67`。该值沿用 TO 夹具标记，不复用 TO 数据根。自建服务器保留 `log_statement=none` 的原配置；不捏造服务器 SQL 语句轨迹，以实际原生输出、原资源审计及独立 canary／只读 oracle 为据。

## 已完成的准备与尚未执行

- [原 TO UI 夹具](../../../../scripts/applications/fixtures/legacy-database-ui-native.mjs)只增加可选 nativeDatabaseRead 回调；原默认路径逐字节逆变换后与 TO 原件相同。复用实际 UI／原生加密流程，无重复新建产品逻辑。
- [TR SQL 业务夹具](../../../../scripts/applications/fixtures/legacy-database-sql-native.mjs)添加固定查询／原脚本字节／9 条原审计断言；[许可门](../../../../scripts/applications/fixtures/database-sql-permission.mjs)要求实际用户答复、对应 scope／问题引用、准确输入 pins，不能用计划、旧 MB／TL 批准或一个环境布尔值代替。
- 私有入口 `/private/tmp/willyou-m10-tr-20261030/run-database-sql.mjs` 默认仅 prepare；`--execute` 和直接私有父入口都在 App 启动前检查批准。真实答复到达后才保存 mode600 的 `approval.json`，没有预填批准文件。
- 一个独立 execution-claim 和三份 `sql-attempt-1/2/3.json` 用 `wx` 固定批次与各阶段预算；失败保留原运行和预算，不自动删除／复建并另跑一批。当前这些文件均不存在。
- **8 项前置检查通过**：纯解析示例不能取得执行凭据；MB／TL scope 拒绝；缺答复／错 pin／超次数拒绝；默认零 App；无批准 execute 零 App；直接父入口同样拒绝；原 TO 默认行为保持；没有实际批准／claim／预算／native.log。正向解析只用内存合成对象，不是用户批准。
- 1524 选定源码只改外部夹具／许可门；生产、原型、依赖／包内容保持，新 TQ 及旧 SW 的 19 pin 继续核对。不因此重建 App 或重复软件／界面绿测。
- **尚未验证**：正向执行分支、网络可达、原生 SQL 返回、9 条审计、权限配置后的业务恢复及实际收尾。准备完成和 8 项预检不能替代这些结果或增加正式通过数。

27 项执行输入的 pins 文件位于 `/private/tmp/willyou-m10-tr-20261030/expected-pins.json`，SHA256 `c648e87f6b661bd12960d2c0052602914efc905c973c42dfdd8d24b596c15ee4`。见[准备证据清单](../验收/证据/db-sql-tr-preparation-20261030/manifest.json)、[原预检结果](../验收/证据/db-sql-tr-preparation-20261030/preflight.log)、[输入 pins](../验收/证据/db-sql-tr-preparation-20261030/expected-pins.json)。原生 CLI 的配置项语义沿用同一固定二进制的 MB config/read 证据，本次未启动 thread／turn 去测试权限。

## 执行条件与回退

需要用户明确允许**本次隔离数据库验证**；答复前保持原 read-only／never，SQL 0、App 0。授权仅用于上述范围。退出本批不影响日常配置；本次网络例外、回执及全部旧拒绝分别记录。若本次必要系统条件不具备就后置，继续其他原步骤，不用其他 RPC／删除审计绕过。
