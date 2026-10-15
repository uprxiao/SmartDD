---
name: smartdd-project-db-diagnostics
description: 根据 SmartDD 当前项目的数据库配置定位目标并执行只读诊断。支持 MySQL、PostgreSQL 协议及兼容数据库。
metadata:
  version: 1.0.0
---

# 项目数据库诊断

复用现有 project-db-diagnostics 查询器。`scripts/db_query.py` 相对于本 SKILL.md 所在目录；用该脚本的绝对路径调用，不以代码工作目录猜测脚本位置。

1. 当前会话的 `PROJECT_DB_CONFIG` 指向 SmartDD 生成的配置。先运行 `python3 <skill目录>/scripts/db_query.py --list`，确认项目、环境、库名和目标。
2. 用 `--db <准确 key>` 或 `--target <明确别名/环境/主机片段>` 选择目标。多个匹配必须澄清，不以列表顺序猜测。生产环境必须有明确授权；未指定环境时先核对目标。
3. 执行 `python3 <skill目录>/scripts/db_query.py --db <key> --show-selected --sql 'SELECT …' --format json`。从小范围只读查询开始，限制行数，必要时使用全限定表名。Desktop 的 schema 会设置到 PostgreSQL search_path。
4. 报告选中的项目、资源、环境和查询结论。连接失败时报告类别，不输出密码、令牌、配置全文或环境变量值。

密码只通过配置中的 `passwordEnv` 引用会话环境。不得寻找其他项目的凭据，不得创建本地 `.env` 或把配置写入代码目录。缺少配置/密码时回到 Desktop 修正并重新启动任务，不猜测连接。

默认只允许查询。`readonly` 资源还会开启数据库只读事务，不能用 `--allow-write` 绕过。写操作须用户明确授权且目标为 readwrite；复杂写入沿用用户已安装的 operate-databases 的计划/审批流程。

依赖：Python 3；MySQL 需要 pymysql，PostgreSQL 协议需要 psycopg2。Desktop 启动自检会提示缺失项。不得因兼容协议相同而宣称所有厂商的认证扩展都已验证。
