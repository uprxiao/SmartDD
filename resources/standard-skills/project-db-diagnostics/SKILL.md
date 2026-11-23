---
name: smartdd-project-db-diagnostics
description: 根据 WillYou 当前项目的数据库配置定位目标并执行只读诊断。支持 MySQL、PostgreSQL 协议及兼容数据库。
metadata:
  version: 1.0.1
---

# 项目数据库诊断

复用现有 project-db-diagnostics 查询器。`scripts/db_query.py` 相对于本 SKILL.md 所在目录；用该脚本的绝对路径调用，不以代码工作目录猜测脚本位置。

1. 当前会话的 `PROJECT_DB_CONFIG` 指向 WillYou 生成的配置。先运行 `python3 <skill目录>/scripts/db_query.py --list`，查看项目、环境、名称、别名、库名和地址。
2. 用 `--env <环境>` 指定环境，用 `--db <key/配置名称/别名>` 或 `--target <精确名称/别名/库名/完整地址>` 指定目标。用户同时给出环境和目标时传入两者，先筛环境，再匹配目标。仅有环境或目标时也必须唯一命中。短数字（如 173）应是配置中的完整别名，不能拿来匹配主机尾号。环境以配置字段为准。如果名称或别名与环境冲突、找不到库或有多个候选，列出名称和环境请用户确认，暂缓查询。用户未指定环境和目标时，仅使用已配置的非生产默认库。
3. 先加 `--show-selected` 核对唯一目标，暂不传 `--sql`。对于生产环境，向用户明确展示项目、资源、环境及拟执行的操作，取得明确授权后再执行。查询时沿用核验过的环境和目标，加 `--sql 'SELECT …' --format json`。从小范围只读查询开始，限制行数，必要时使用全限定表名。Desktop 的 schema 会设置到 PostgreSQL search_path。
4. 报告选中的项目、资源、环境和查询结论。连接失败时报告类别，不输出密码、令牌、配置全文或环境变量值。

密码只通过配置中的 `passwordEnv` 引用会话环境。不得寻找其他项目的凭据，不得创建本地 `.env` 或把配置写入代码目录。缺少配置/密码时回到 Desktop 修正并重新启动任务，不猜测连接。

默认只允许查询。`readonly` 资源还会开启数据库只读事务，不能用 `--allow-write` 绕过。写操作须用户明确授权且目标为 readwrite；复杂写入沿用用户已安装的 operate-databases 的计划/审批流程。

依赖：Python 3；MySQL 需要 pymysql，PostgreSQL 协议需要 psycopg2。Desktop 启动自检会提示缺失项。不得因兼容协议相同而宣称所有厂商的认证扩展都已验证。
