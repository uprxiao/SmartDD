# M5：AIS 端到端验收

验收日期：2026-10-15。本文为公开仓库脱敏版；真实地址、目录、资源标识、业务统计和部署时间仅保留在本机验收记录。PRD V1–V10 的隔离自动化验收与日常 SmartDD 的真实界面复验分开记录。沿用 M4 的项目、AI 配置、终端、Skill 和注入能力；M5 增加验收脚本，并修复真实交互中暴露的 Claude 配置根及终端颜色问题。

第一轮使用隔离数据和原生 CLI 的 `--print` 模式，未覆盖用户日常页面里的完整交互启动。此前据此表述为完整页面验收通过，范围过宽。用户提出后，补走了下面的实际页面流程，复现启动失败、修复，再由页面里的 CC-work 完成查询。

用户授权选择简单的只读功能，采用 **AIS 场景列表查询**。真实模型测试前，用户明确授权现有 CC-work / CC-deepseek 接口处理最小验收信息：少量相关源码、表名与统计数量、服务器标识及日志时间戳。没有发送密码、令牌、业务明细或日志正文。

## 实际配置

AIS 的完整工作副本路径：

```text
<AIS 工作副本绝对路径；从本机 Skill 配置读取>
```

数据库配置取自现有 `project-db-diagnostics` 的 AIS/dev 映射；SSH 配置取自现有 `remote-password-ssh` 的唯一 AIS/dev 服务器。只取开发环境，不连接生产和禅道。密码由脚本在内存中读取，通过 SmartDD 原有接口用 safeStorage 加密保存。

按用户追加要求，已把这两项资源补入**日常 SmartDD 的 AIS 项目**，在界面选中 AIS，并对保存后的配置重新测试：

| 项目 | 保存值与验证结果 |
| --- | --- |
| 开发数据库 | 登记的开发库；MySQL 协议，响应 OceanBase；`DATABASE()` 与登记值核对一致；连接测试通过 |
| 数据库访问策略 | SmartDD 登记为 `readonly`，查询 Skill 开启只读事务；不等同于声称数据库账号本身只有 SELECT 权限 |
| 开发服务器 | 登记的开发服务器；响应主机与登录账号核对一致；连接测试通过 |
| SSH 执行策略 | 使用登记的登录账号，`--no-root`，不额外 sudo；读取主机、日志时间戳及追加验收要求的包/进程时间信息 |
| 应用目录 | `<登记的应用部署目录>` |
| 日志 | `<登记的应用日志相对路径>`；只输出截取后的时间戳，不输出正文 |

第一轮自动化验收使用日常配置的**加密副本**和隔离的 SmartDD userData / Claude 配置根。原有 CC-work、CC-deepseek 的接口、模型、凭据保持原样；仅在测试副本中增加 CLI 非交互输出、只读工具许可和预算上限。后续页面复验直接使用日常 AIS 项目及 CC-work，不增加非交互参数。

| PRD 示例名称 | 本机实际名称 | 配置接口 | CLI 初始化与响应报告的模型 |
| --- | --- | --- | --- |
| CC-Claude | CC-work | `https://zenmux.ai/api/anthropic` | `claude-opus-5-5` |
| CC-DS | CC-deepseek | `https://api.deepseek.com/anthropic` | `deepseek-flash[1m]` |

## 日常页面复验：Skill / Agent 数量与 开发服务器包时间

通过真实鼠标点击和键盘输入，在首页选择已有 AIS 项目、完整代码目录、CC-work，填写只读调查问题并启动。没有重复创建已经登记的 AIS 项目，也没有用 `tasks.create` 调用替代这次页面启动。任务标识保留在本机验收记录，用户可在 AIS 下打开「请帮我只读调研 AIS 开发环境（开发服务器）」查看过程。

首次启动失败：终端进入 Claude onboarding 并请求 `api.anthropic.com`，报 `ECONNRESET`。原因是 M4 把隐式默认根也导出为 `CLAUDE_CONFIG_DIR=~/.claude`，使 Claude 改读 `~/.claude/.claude.json`，丢失原来 `~/.claude.json` 的 onboarding / trust / MCP 状态。修复后，默认根保持未设置；用户明确指定的根继续生效，恢复任务保留原来的根语义，能力扫描也区分这两种情况。没有复制或改写用户的全局 Claude 配置。

重新打包、重启日常应用后，打开同一任务，在原生终端输入调查问题。Claude Code 2.1.300 / Opus 5.5 实际调用项目上下文 MCP，成功加载 `smartdd:project-db-diagnostics` 和 `smartdd:remote-password-ssh`，执行查询并返回结果：

| 查询对象 | 实测结果与口径 |
| --- | --- |
| Skill 表 | 已核对总量及启用、停用分组；具体业务数量不公开 |
| AIS Agent 表 | 已核对总量及上架、下架分组；具体业务数量不公开 |
| DEV Agent 配置表 | 独立统计，不与 AIS 智能体相加；具体业务数量不公开 |
| ToolAgent 包 | 已取得部署包绝对路径与精确 mtime；具体值保留在本机验收记录 |
| 对应进程 | 已核对 PID、cwd 及进程启动时间，不能将此时间当成包修改时间 |

统计读取列定义并核对相关删除代码后按现存行统计；Skill 和 AIS Agent 的删除路径是物理删除。连接审计共 27 条：数据库 7 次连接、6 次查询完成、1 次 SQL 错误；SSH 2 次均成功。SQL 错误来自模型先写了不存在的 `scene_id`，随后查表结构改为 `scene_code` 并成功完成。全部审计的项目 ID、配置版本/hash、资源 ID 与日常 AIS 配置一致，目标与登记的开发库和服务器一致。

核对原始工具输出后保留两项解释边界：`readonly` 是 SmartDD 访问策略与查询事务设置，没有检查数据库账号的实际授权；mtime/ctime 及进程启动时间不能证明二进制版本一致或文件从未被再次改动。模型原回答在这两点上的表述过强，不作为验收结论。AIS 工作副本前后 `svn status --no-ignore` 完全一致。

恢复会话后，在原生终端追加了仅使用已有上下文的收尾问题。CC-work 正确复述数量及包时间，并在同一会话明确更正上述两处表述；审计仍为 27 条，没有因此新增数据库或 SSH 访问。更正后的回答保存为 `cc-work-answer-corrected.md`。

页面复验期间用户还发现终端全黑白。实际应用继承了启动器的 `NO_COLOR=1`；捕获到的 ANSI 控制码只有反显和下划线，没有颜色码，渲染也只有一种前景色。修复在新 PTY 启动时剔除父进程的 `NO_COLOR` / `FORCE_COLOR` / `CLICOLOR` / `CLICOLOR_FORCE`；shell rc 和 AI 配置中明确设置的颜色偏好仍可生效，不改用户的 Claude 主题文件。

颜色修复重新打包后，刻意让日常应用主进程继续带着 `NO_COLOR=1` 启动，再通过侧栏点击恢复原 AIS 任务。原生会话 ID 不变，自检通过；实际 Claude 输出已包含 `38;2;…` 真彩色控制码，页面检测到 6 种文字颜色，修复前只有 1 种。浅色/深色主题另通过打包 GUI 的彩色探针验证。验收结束清理临时页面监听，保留原 AIS 会话和已更正的查询结果。

## 第一轮隔离自动化 V1–V10 结果

| 编号 | 结果 | 核对依据 |
| --- | --- | --- |
| V1 目录与启动 | 通过 | 实际 PTY 的 cwd 与完整 AIS 路径一致；运行自检通过；任务快照有变量名清单。打包应用 GUI 回归确认任务信息展示变量名和注入状态 |
| V2 数据库匹配 | 通过 | CC-work 实际执行注入的数据库 Skill；审计记录中的 projectId、configHash、host、port、database 与本轮配置一致；查询返回登记的 AIS 库及场景统计数量 |
| V3 服务器匹配 | 通过 | CC-work 实际执行注入的 SSH Skill；审计确认连接登记的开发服务器；返回 hostname 和当天日志时间戳 |
| V4 不串项目 | 通过 | CC-deepseek 在单独的对照项目调用同样的 Skill，连接独立的本机 MySQL/SSH 模拟服务；返回 `smartdd_m5_control` / `SMARTDD_M5_CONTROL_SERVER`；该任务连接审计无 AIS 地址 |
| V5 业务闭环 | 通过 | 模型报告给出业务逻辑、数据存储、当前环境、对应页面、实际数据库五方面信息；逐项与源码和独立资源查询核对，见下节 |
| V6 密钥安全 | 通过 | 在打包应用主进程内解密比对 2 个 AI 凭据及 4 个资源密码，扫描 83 个文件与内存中的日志/脱敏 DTO；SQLite、投影、审计、终端测试记录、原生 CLI 会话文件均无明文匹配；比对过程不返回密钥 |
| V7 会话恢复 | 通过 | 第一轮给模型随机校验词；关闭测试应用后重新打开，通过原任务的 native session ID 恢复；第二轮没有提供校验词且不调用工具，仍准确回忆原词 |
| V8 连接失败分类 | 通过 | 故意向本机对照 MySQL 和 SSH 输入错误密码，均返回 `auth`；不对 AIS 账号反复尝试错误密码 |
| V9 能力识别 | 通过 | 静态扫描维持「加载未核验」；真实 CLI 初始化列出两个 `smartdd:` Skill 和 connected 的项目 MCP，且模型实际调用了 `project_context`。单独的 Codex / Claude 本机能力探针也通过 |
| V10 AI 配置 | 通过 | 上表两套已有配置均完成真实模型响应；所报模型不同且与各自配置一致；令牌在返回界面的 DTO 中为 null，并通过 V6 明文检查 |

V4 的第二套资源是本机协议服务，证明项目选择和连接隔离；没有宣称第二个真实业务系统也已验收。V9 的测试证据不会把产品中所有任务的状态统一改成「已加载」。

## 场景列表的事实核对

1. **页面与接口**：`ultrasafe-ais-view-ms/src/dev/aiScene/index.js` 的 `SceneManage` 使用 `ais + '/scene'`，`DataTableConfig` 以 GET 获取分页列表；初始页为 1，每页 10 条。
2. **业务路径**：`ultrasafe-ais-web-ms/.../controller/SceneController.java` 的 `GET /scene` 接收 `SceneQueryDTO`，调用 `SceneService.querySceneList`，由 `SaSceneDAO.querySceneList` 完成分页查询。
3. **存储与筛选**：主表为 `SA_SCENE`，关联类型、模型、Agent 配置和工具类型字典；外层过滤 `IS_DELETED = 0`；支持场景名称、编码、类型、启用状态、模型和工具类型筛选；默认按 `DISPLAY_SEQ ASC` 排序，由 `queryPageData` 分页。
4. **实际库**：独立 PTY 资源探针与 CC-work 返回相同的数据库身份和场景表统计数量（具体值不公开）。该 SQL 没有删除标志过滤，不能把统计数量当成页面列表条数，也没有把业务记录交给模型。
5. **实际环境**：SSH 连接到登记的开发服务器，读取到 2026-10-15 的日志时间戳。这证明目标与日志可读，不扩大解释为所有服务健康或部署版本一致。

页面核对限于**源码、请求方法及接口映射**，没有登录 AIS 浏览器页面验收显示效果、筛选和分页。V5 要求的五方面调查已经形成证据；AIS 产品自身完整 UI 验收不包含在此次 SmartDD 验收内。

调查还发现 AIS 源码的一个待确认问题：`SaSceneDAO.querySceneList` 将 `s.IS_ENABLED` 拼接在外层别名 `h` 的查询上，可能导致启用状态筛选报错。当前只作源码发现，未执行该业务条件复现、未修改 AIS。验收前后 `svn status --no-ignore` 完全一致。

## 测试与证据

本轮执行：

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 页面缺陷修复后 31 个文件 / 274 项通过；2 项 CLI 探针默认跳过；新增配置根与实际 shell 颜色回归 |
| `pnpm probe:m4:cli` | 两项实际 CLI 探针单独通过，使用本地模拟模型 API |
| 打包应用 GUI 回归 | 修复后通过：设置/版本、项目开关、首页启动、实际 PTY 自检、变量名、未核验状态、中英文及 800px 窗口；额外以父进程 `NO_COLOR=1` 验证浅色/深色终端的 ANSI 和真彩色；无 renderer 异常 |
| `pnpm package` | 修复后重新打包通过；保留既有 theme-init/zod 非阻断构建提示 |
| M5 隔离自动化流程 | 通过：AIS 资源、两个真实模型、对照隔离、重启恢复、工作副本检查；真实模型采用 `--print` |
| 日常页面真实查询 | CC-work 完成：首页选 AIS / AI → 原生交互终端 → 实际数据库统计 → 开发服务器包与进程时间 → 回答；连接审计和原始输出已核对 |
| 日常页面恢复与颜色 | 同一原生会话恢复成功、自检通过；真实 Claude 的真彩色控制码和页面多色渲染均已核实 |
| 完整流程后的凭据审计 | 6 个凭据、83 个文件，0 个明文泄漏匹配 |
| 合并凭据审计后的资源模式复跑 | 通过；未重复调用付费模型 |
| 脚本语法与差异检查 | `node --check`、`git diff --check` 通过 |

第一轮使用 M4 的 `release/mac-arm64/SmartDD.app`。后续页面复验修改了应用运行时代码，修复默认配置根和颜色变量继承；因此重新类型检查、全量测试和打包。M4 原有构建及 7 项底层探针结果见 [M4 说明](./M4_Skill与配置注入.md)。

本机临时证据（目录由系统清理，复跑会生成新的目录）：

- 完整真实流程：`$TMPDIR/smartdd-m5-7i7Eph/`，含 `result.json`、两模型 `*-evidence.json` / `*-audit.json`、终端记录、`claude-resume-terminal.txt` 和 `secret-audit.json`。
- 合并后资源模式：`$TMPDIR/smartdd-m5-2h8vdT/result.json`。
- 打包 GUI：`$TMPDIR/smartdd-m4-ui-kc9V6x/`。
- 颜色修复后的打包 GUI：`$TMPDIR/smartdd-m4-ui-oR0iQs/`，含浅色/深色彩色终端截图与 `result.json`。
- 日常页面：`$TMPDIR/smartdd-m5-page-NArQZK/`，含首页/失败/输入/回答截图、`cc-work-answer.md`、`resource-audit.json`、核对后的 `result.json` 和工作副本前后状态；`05-native-claude-colour.png` / `colour-after.json` 记录真实 Claude 的颜色修复结果。

测试终端记录只保存在受限临时验收目录，不改变产品默认「不持久化终端全文」的行为。完整证据包含少量内部源码和环境信息，不纳入仓库；本报告仅保留脱敏验证结论。

## 复跑

```sh
# 常规回归
pnpm typecheck
pnpm test
pnpm probe:m4:cli
SMARTDD_UI_APP=release/mac-arm64/SmartDD.app/Contents/MacOS/SmartDD node scripts/m4-ui-smoke.mjs

# 需要已构建的本机 .app、可用 Keychain、现有 AIS/dev Skill 配置及两套 AI 配置。
# 默认使用正常 HOME；隔离 SmartDD 数据与 Claude 会话，不更改日常配置。
# 真实模型模式会调用上表接口并消耗额度，处理范围见本文开头。
pnpm probe:m5 --live

# 仅验证真实 AIS 资源 + 对照服务 + 凭据审计，不调用模型。
pnpm probe:m5 --live --resources-only
```

可用 `SMARTDD_UI_APP` 指定本机应用路径。Python 3 需有数据库驱动，PATH 中需有系统 ssh 和 Claude CLI。错误的资源映射、缺少凭据或歧义会停止验收。

`scripts/m5-import-ais.mjs` 是此次用户要求的日常配置导入入口；必须显式提供 `--apply` 及当前 SmartDD 的本机调试端口。它核对日常数据目录、唯一 AIS 项目和完整代码路径，仅补缺失开发资源，不覆盖不同目标，也不导入测试 AI 参数。常规 `probe:m5` 不执行该导入。

测试脚本中的 `resource-runner.py` 是资源链路探针；真实模型结果另由 `live-agents.mjs` 执行并以独立连接审计确认，未把假运行器结果充作模型验收。最初 stream-json stdin 不适用于此 CLI 的 PTY 启动检查，测试方式已改为原生 `--print` 首条消息参数，恢复时仍通过 SmartDD 的 `tasks.open` 和原生 `--resume`。
