# F16 开发前专项实验 E01–E09（2026-11-25）

依据：[F16 R1.0](../../../需求.md)（起始 R0.3 七轮业务确认）、[技术方案 T1.0](../../技术方案.md)。生产输入冻结在 feature/0.1.7、a0acddb3a2325c6bf732adaa7e954ce4d767a2c3；macOS arm64、Node v22.23.1、Electron 42.11.14（内置 Node 24.19.0）、现有 better-sqlite3 12.11.1 Electron ABI。各组使用独立 HOME/数据库/测试目录、合成数据及本地通道；不改生产模块、不安装或发布 App、不使用日常登录和外部供应商。前置实验组 **9/9 已完成**；这是完成设计可行性实验的统计，不是正式验收通过率。

| 编号 | 实际实验和结果 | 结论／正式缺项 | 证据 |
| --- | --- | --- | --- |
| E01 | 12/12；真实时间引擎、日历/Cron/时区边界和速度 | 同源规则可行；产品主进程及真实多任务延迟待验 | [时间脚本](e01-time.test.mjs)、[日志](e01-time.tap) |
| E02 | 真实 SQLite、7 项持久化/修订/归档/时区及索引试验通过 | 迁移和计划/任务事务生产接线未实现；候选库不等于真实用户数据迁移 | [候选](ledger-candidate.mjs)、[E02/E08 日志](e02-e08-ledger.tap) |
| E03 | 现有 AgentTaskService、AgentStore、真实事件和去重；实际三种 CLI 服务链 | 现 submit 是 user，enqueueHost 是 system 等且会排队。须新增可信计划 origin 与忙碌原子跳过 | [E03–E05 详细报告](E03-E05/README.md) |
| E04 | 本机三条真实原生 CLI 共 9 个真实回合、模型与档位请求（合成协议） | 本机版本为证据，不强绑；真实授权 Provider 联网验收另做 | [真实回合及复核](E03-E05/verified-summary.json) |
| E05 | 新建/同任务 nativeId 续聊、代次、模型档位跟随、错误选择/归档/Agent/Provider 兼容身份实测 | 生产绑定及确认、原子忙碌门槛必须实施 | [绑定证据](E03-E05/README.md) |
| E06 | 现有 8/8 Git/file 及登记目录回归；真实 Git、SVN/普通目录、专属/逐次、空项目 FileSource；真实 profile 元数据隔离候选 | 计划 owner 独立、真实顶层 cwd、standalone scope 和实际 browser/UI 需接线，不借假项目或虚构子任务 | [E06/E09 报告](E06-E09/REPORT.md) |
| E07 | 两个真实 Electron 隔离进程：隐藏、最小化、关闭隐藏、真正退出后重新启动；synthetic resume hook 宽限补跑 | mac 原生窗口及生命周期已验证；真正 OS 睡眠、系统真实打包 App 和其他平台待正式验收 | [首进程](e07-first-final.log)、[重开](e07-reopen-final.log) |
| E08 | SQLite 多进程竞争、同 plan/target 冲突、手动请求去重、错过范围、崩溃 receipt 核对、重试与超宽限、计时并行及 pre-accept revision 检验，10/10 | 账本候选通过；真正 AgentTaskService 接受事务和实际业务效果的完整端到端故障验证待生产实现 | [脚本](e02-e08-ledger.test.mjs)、[进程 worker](ledger-worker.mjs)、[实际日志](e02-e08-ledger.tap) |
| E09 | 既有 host/permission 74 通过 1 既有可选长时 skip；实际 store/任务树、global Skill/MCP 投影、真实 native CLI/合成插件和 mail、browser scope guard、原通知 adapter | 本期复用原服务且新增 explicit schedule provenance；全局投影按真实 typed scope 而非 cwd；实际 standalone 浏览器、系统通知及 F36 联动尚待实现/验收 | [详细实验及红绿记录](E06-E09/REPORT.md) |

## E01 日程语义与速度

实验脚本用 Intl 往返校验有效墙钟；按可能的日及候选时分跳过非命中分钟，五字段 Vixie 子集（词法 wildcard DOM/DOW 规则）；无效/无未来拒绝。覆盖月末/缺日/闰年跨世纪、工作日/多星期、间隔 anchor/一次 UTC、合法固定时区/跟随、NY DST、Lord Howe 半小时、Apia 缺日、Kathmandu 非整小时偏移。36 组独立 UTC 分钟枚举 oracle 对照。400 个计算样本 p50 0.057ms、p95 0.114ms、最大 0.212ms；实际轻量 timer 延迟 0–1ms。这不是完整 Agent 派发延迟。Cron/DST 边界依据实验进入 R1.0 供最终评审。原型同源副本 SHA 与候选相同。

复跑：在仓库根执行 node --test 对本目录 e01-time.test.mjs（不启动 App/网络）。

## E02/E08 真实候选账本与派发竞争

运行 E02/E08 使用 Electron 内置 Node 与真实 SQLite WAL，独立临时数据库。17 项通过（E02 7 项，E08 10 项），使用真实两 worker 竞争和真实子进程终止来证明数据库持久领取与回执重查，外部主机效果使用独立的合成 receipt 表，不是原 TaskService 已接入。2,200 行真实表（2,000 暂停/200 启用）核对 due index，EXPLAIN 使用 due_plan；轻量 p95 和三个实际 timer 延迟以 [最终日志](e02-e08-ledger.tap) 记录值为准。慢一个计划不阻碍另两个，空闲无 timer。E02 v1/E08 第一批 14 项通过；后续补验证已消耗墙钟不再显示为下次、仅展示时区变化不漂移、删除后手动重放仍返回旧 receipt、恢复 0 宽限不迟补、领取后编辑/暂停/删除的接受前修订门槛；保留 [原结果](历史-v1/e02-e08-ledger.tap) 和旧候选。checkBeforeAccept 仅独立账本技术门槛，生产还须与真实 AgentStore accept、任务占用及事件最终 commit 同事务。

复跑命令（仓库根）：

```sh
ELECTRON_RUN_AS_NODE=1 "$(node -p 'require("electron")')" --test --test-concurrency=1 docs/里程碑/M16_定时任务/技研/实验/F16_20261125/e02-e08-ledger.test.mjs
```

普通 Node 加载 Electron ABI 的 better-sqlite3 不适用。

## E03–E05 真实 Agent 链

[报告与复跑方法](E03-E05/README.md) 由独立执行者生成。子目录 MANIFEST 经完整校验；真实 CLI 只访问本机确定性协议夹具并验证 PID 结束；未启动完整打包 App、未调用第三方模型、未代替用户登录。9 次 native turn 和 UI 原型行为不是 9 条正式验收。

## E06/E09 目录、能力、真实权限与任务树

[报告与原始记录](E06-E09/REPORT.md)、[复跑脚本](E06-E09/replay.sh)；39 个脱敏/合成证据与驱动由原 MANIFEST 校验。完整冻结生产树、运行 cache/HOME、私有数据库不入库。原始实验脚本的绝对路径保留实际证据，重新执行须重建同 Git 提交的冻结源码与独立数据，再按报告复制测试驱动，并使用实际本机只读依赖/受准 native helper。同目录额外实证见 [专项复核](E06-E09/same-cwd-review-e09/result.json)：两个真实数据库任务 cwd 完全相同（一个 project 归属、一个 null/null），直接 selected(cwd) 均获得 4 项（含项目项）；显式 standalone 走现有 registry.selected(undefined) 后只选 2 项 global，原 project 仍为 4 项。新增用例 1/1 通过，真实 scope 传参与原生运行接线仍为开发项。现有 74 通过/1 skipped 属既有回归（可选长时测试未运行）；已实际新增关键验证。专项证据与原始失败都有记录，不宣称每个底层既有测试全绿或正式系统验收通过。

## E07 窗口及重开

[生命周期脚本](e07-lifecycle.mjs) 使用真实 Electron BrowserWindow/actual app.quit，独立用户数据；仅 about/data 页面，不操作日常窗口，原生窗口不抢焦点，三显示器环境使用独立试验窗；时间缩短为内部毫秒一次时点，仅测试生命周期/候选账本，不代表产品允许秒级计划。最初 sandbox 启动返回 134（[空日志](e07-first.log)），许可隔离窗口后第一轮 close 立即 hide 但恢复动画迟到使后续可见，保留 [原日志](e07-first-retry.log)；夹具改为验证稳定实际 restore/hide，后续三次分别在初始隐藏、最小化及实际关闭隐藏状态派发，lag 3/2/1ms，focused=false。在既有实际 powerMonitor resume 处理点注入合成唤醒事件，没有人为睡眠用户电脑；宽限内完成、0 宽限跳过。真实进程正常 app.quit 退出后经历下一次时点，再启动同隔离根验证完全退出期间无接受，宽限内仅一次补跑、0 宽限跳过。E07 原运行使用 v1 账本候选（[历史-v1](历史-v1/)）；最终账本变更独立 E02/E08 重测。物理睡眠、Cmd+Q 真实用户输入、取消退出、系统通知和完整打包产品仍列 A 用例，不能用此替代。

## 最终边界

本轮完成的是开发前技术实验。在正式开发中，计划版本/任务接受原子性、真实 standalone 浏览器、精确 origin graph、真实 Worktree owner、完整迁移和通知尚未实现。详见 T1.0 与 A1.0，不因本轮完成而擅自进入生产开发或安装。原型验证和独立复核见 [P1.0](../../../原型/原型说明与变更.md)，也不是正式 App 结果。
