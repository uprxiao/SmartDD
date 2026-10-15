# M4：Skill 与配置注入

接手基线：`b54e05b`（M3 评审修复完成）；类型检查、27 个测试文件 / 230 项测试通过。

## 首版实现范围

- 沿用现有项目、凭据、AI 配置、PTY、任务与恢复流程。
- 标准包先采用 `project-db-diagnostics` 与 `remote-password-ssh`，白名单复制脚本，清理说明里的个人路径和环境信息。既有 `operate-databases` 继续作为本机 Skill 识别；完整写操作审批体系不在本次改造中重写。
- 按项目启停标准 Skill，保留安装版本；更新影响新任务，已有任务保留版本快照。
- Claude 使用会话插件；Codex 使用用户级自有命名空间投影与会话禁用参数。不得覆盖用户已有内容，不写工作副本。
- SQLite 生成每轮独立的资源配置，仅解密当前项目且所启用 Skill 需要的凭据。数据库和 SSH 都使用 `passwordEnv`，SSH 保留旧明文字段兼容；SmartDD 自身不生成明文密码文件。
- 实际 PTY 的登录 shell 完成变量导出后，运行自检程序，校验文件哈希、配置身份、环境引用和依赖；通过后才执行 CLI。记录不含值的自检结果，失败显示原因。
- 设置、项目页与任务信息展示来源、版本、配置版本和能力状态；扫描现有 Skill/MCP，始终将静态发现与实际加载分开。
- 本版 MCP 识别已有配置，按会话注入只读的 SmartDD 项目上下文服务。服务只返回非敏感资源身份和配置路径，供模型核对当前项目。

## 使用方式

1. 在项目中登记目录、数据库与服务器，保存凭据。项目的「Skill 与 MCP」默认启用两个标准 Skill 和只读项目上下文 MCP，可分别关闭。
2. 设置页的「Skill 与 MCP」展示内置来源、版本历史与随包更新；选择 AI 配置后，扫描该运行器、配置根及项目目录的能力。
3. 首页展开「本次任务能力」查看启用版本与已发现能力。启动后先执行实际终端自检，再进入 CLI；失败显示原因并阻止 CLI 执行。
4. 任务顶栏 ⓘ 展示变量名、配置版本/hash、版本快照、自检结果及资源连接记录路径。当前任务中的实际加载没有自动取证时，一律显示「加载未核验」。

依赖沿用现有脚本：登录 shell 中有 Python 3 和 `ssh`；使用 MySQL 资源需要同一 Python 的 `pymysql`，PostgreSQL 协议资源需要 `psycopg2`。未满足时自检失败，提示具体模块。脚本在 Desktop 以外运行时必须显式提供 `--config`，避免误读用户的全局资源配置。

## 实现与数据

| 位置 | 职责 |
| --- | --- |
| `src/main/core/capabilities/` | 标准包版本、项目开关、只读扫描、配置投影与自检计划 |
| `resources/standard-skills/` | 两个适配 Skill；`provenance.json` 记录采用的上游文件/hash |
| `resources/runtime/` | 实际终端中的自检与只读 stdio MCP |
| `src/main/core/tasks/task-service.ts` | 统一启动入口；捕获本轮凭据做错误脱敏；退出按 PTY/run 清理 |
| `drizzle/0004_capabilities.sql` | `skill_versions`、`project_capabilities` 与 `tasks.runtime_snapshot` |
| `src/renderer/views/capabilities.tsx` | 设置、项目、启动预览、任务能力展示 |

随包文件由 Vite 嵌入 main 构建结果，生产包不依赖源码目录。`userData/capabilities/packages/<skill>/<hash>` 保留不可变版本；升级仅切换活动版本。Claude 插件与配置在 `runs/<project>/<task>/<run>/` 中生成；Codex 自有目录形如 `~/.agents/skills/smartdd-<skill>-<hash>`，通过本次 `skills.config` 逐路径启停。已有不同内容的自有投影会备份并报告文件/hash 差异，拒绝覆盖；同名用户目录保留原样。

每轮资源配置包含项目 ID、SQLite 配置版本与 hash。只解密当前项目、当前启用 Skill 使用的凭据；`SMARTDD_`、`PROJECT_DB_CONFIG`、`REMOTE_SERVERS_CONFIG` 为保留命名空间。继承环境及 shell rc 中的旧项目变量先清除，再导出本轮值；HOME 与运行器配置根也与扫描/投影保持一致。旧任务恢复保留 M3 的原会话根，并保留已选择的 Skill 版本。

M5 日常交互复验补充修复：Claude 的隐式默认配置根保持未设置，保留 `~/.claude.json` 的原生状态；显式 `CLAUDE_CONFIG_DIR` 使用其目录内的 `.claude.json`，即使目录正好是 `~/.claude`，也不能混为一谈。启动与恢复、静态扫描按相同规则处理。新 PTY 不继承外层自动化进程的颜色开关，避免 `NO_COLOR=1` 使原生 CLI 全黑白；shell rc 和 AI 配置的明确选择仍保留。复验结果见 [M5 报告](./M5_AIS端到端验收.md)。

脚本沿用目标匹配、歧义拒绝和危险操作检查。额外适配了数据库厂商到协议的映射、PostgreSQL schema、readonly 事务；SSH 增加密码环境变量和私钥/口令认证。没有拷贝连接配置、`.env`、个人路径或历史运行产物。

`resource-audit/<project>/<task>.jsonl` 是独立的非敏感连接记录，权限 `0600`，任务退出后保留用于核对目标。数据库在实际连接成功后记 `connected`；SSH 仅在系统 ssh 退出码为 0 后确认连接及完成。记录包含目标身份、版本/hash、状态和时间，不含查询行、SQL、命令或凭据。它不是终端全文记录，也不证明失败的 SSH 命令已经成功认证。

## 扫描边界

使用真正的 YAML/TOML 解析，保留同名不同来源；符号链接 realpath 去重，遇到 SKILL.md 后停止向下扫描，跳过 validation/productions 等历史目录。扫描以所选 AI 配置的 HOME、CODEX_HOME/CLAUDE_CONFIG_DIR 和项目工作目录为准；Claude 仅按插件安装清单扫描，不把整个缓存当成已启用插件。

MCP 配置可能含凭据，解析发生在主进程。返回界面的白名单字段不含参数、URL、环境变量值或 header 值；解析错误只显示分类，不回显配置片段。扫描不解密 AI 配置令牌，不启动 MCP、不请求模型。运行依赖、网络、认证、项目信任等静态不能确认的内容显示「部分待核验」。

## 已执行验证（2026-10-15）

| 验证 | 结果 |
| --- | --- |
| M3 接手基线 | 类型检查通过；27 文件 / 230 项测试通过 |
| 类型检查与全量回归 | 类型检查通过；31 个测试文件 / 266 项测试通过，另 2 项真实 CLI 探针默认跳过并单独运行通过；覆盖原 M3 修复与新增 M4 场景 |
| 项目与凭据隔离 | 两项目投影与环境互不包含对方凭据；关闭 Skill 不解密对应资源；投影、argv、快照不含明文测试密码 |
| 失败与恢复 | 损坏文件/hash、缺变量/依赖阻止 runner；旧 PTY 退出不清新轮文件；恢复保留 Skill 版本；注入失败不误判 AI 账号失效 |
| 实际 PTY | 登录 shell rc 覆盖测试通过，子进程看到当前项目且看不到旧项目变量 |
| 数据库脚本 | 真正 Python 驱动对本机 MySQL/PG 协议模拟端连接/查询通过，检查用户名、库名、密码、schema、只读事务和连接记录 |
| SSH 脚本 | 系统 OpenSSH 对本机 SSH 模拟服务的密码、私钥、加密私钥认证通过；歧义和危险命令拦截通过；临时 known_hosts 不影响用户文件 |
| 真实 Codex 0.162.1 | app-server 的 skills/list 读到投影及启停状态；mcpServerStatus/list 连接项目 MCP 并发现 project_context |
| 真实 Claude Code 2.1.300 | 插件 Skill 进入实际请求；通过仅在 127.0.0.1 的模拟模型 API 调用项目 MCP，并拿到当前项目上下文；未使用付费模型接口 |
| Electron GUI | 开发构建与实际 `.app` 包均通过：设置目录/版本、项目开关保存、首页预览、启动→实际 PTY→任务自检信息、中英文及 800px 视窗；没有 renderer 异常 |
| 构建 | electron-vite 生产构建通过；保留既有 theme-init/zod 非阻断提示 |
| macOS 打包 | `pnpm package` 通过，产物为 `release/mac-arm64/SmartDD.app`，沿用自用阶段的未签名配置 |
| 打包底层探针 | 正常用户 HOME + 独立临时 userData 下 7 项全部通过：SQLite、PTY、safeStorage、子孙进程环境传递、Claude/Codex 版本与 PATH；safeStorage 加解密一致且测试数据库无明文 |

复现命令：

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm probe:m4:cli
pnpm probe:m4:ui
pnpm package
SMARTDD_UI_APP=release/mac-arm64/SmartDD.app/Contents/MacOS/SmartDD node scripts/m4-ui-smoke.mjs
```

常规测试默认跳过两个需要本机 CLI 的探针；`probe:m4:cli` 单独启用。GUI 探针在系统临时目录建立全新 HOME/userData、假运行器和工作副本，输出 `result.json` 与截图路径。CLI 探针用真实 CLI，但无真实模型或业务环境请求。

本轮 GUI 记录与截图位于系统临时目录下的 `smartdd-m4-ui-iydXLb/`（开发构建）及 `smartdd-m4-ui-uRWjhL/`（实际应用包）。这是临时测试产物，可用上述命令重新生成。

底层探针通过记录在临时目录 `smartdd-m4-keychain-probe-likho8bx/result.log`。复测采用正常用户 HOME、独立 `SMARTDD_USER_DATA` 和 `SMARTDD_PROBE=1`，不调用模型、不修改日常数据库。此前同时改成临时 HOME 的两次运行停在 safeStorage 调用阶段并被超时结束；该隔离方式不作为系统钥匙串验收依据。探针现会逐项输出开始/完成状态，便于定位类似停顿。

本轮还复现并修正了原 SSH 测试的偶发问题：ssh2 1.17 的 Ed25519 生成器会把公钥首部合法零字节裁掉，导致生成的测试私钥偶尔不可解析。临时测试密钥改由系统 ssh-keygen 生成，仍由原驱动完成认证测试；生产连接实现未因此变更。

打包时还修复了现有依赖的重建问题：electron-builder 会尝试重建 ssh2 的可选 `cpu-features`，但该模块的安装脚本没有被项目放行，缺少 `buildcheck.gypi`。打包改为先显式调用已有的 `pnpm run rebuild`，只按 Electron ABI 重建必需的 better-sqlite3 和 node-pty，再关闭 builder 的重复重建；ssh2 沿用可选加速不可用时的内置实现。

## 后续边界

M4 交付时，AIS 的真实数据库、服务器和业务功能闭环留待 M5，没有把本机模拟结果写成 AIS 正式验收通过。2026-10-15 已完成这部分真实验收，范围和证据见 [M5 验收报告](./M5_AIS端到端验收.md)。其他厂商扩展认证、用户外部 MCP 的网络/OAuth、全部外部 Skill 的运行依赖没有据此宣称通过。内置版本升级目前指随应用提供的版本切换，尚无远程市场下载。

正常退出清理本轮投影；异常断电可能留下不含密码的配置快照。环境变量对 CLI 及其子进程可见，维持 PRD 已接受的边界。任务信息里的「自检通过」证明配置进入了终端，并不等于该生产会话已经调用所有能力。
