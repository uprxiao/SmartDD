# M14 阶段 6 首包验收

2026-11-18 开始。源码为 `36dfb7ae652d6c37f4b9355e772d924d5b8f6c81`，对应 Claude 与 Codex 的 A1.12 验收范围。目标平台为 macOS arm64。包只留在本轮隔离目录，未安装到日常应用。正式用例状态在[唯一执行账](../../../执行与缺陷记录.md)。

## 构建

- 首次执行 `pnpm package --output-dir <本轮私有路径>` 在系统沙箱内验证 LibreOffice 签名失败。[失败日志](build/package-attempt-01.log)
- 对同一份 LibreOffice 资源独立执行系统签名校验成功。随后使用系统权限复跑完整构建，保留原资源锁和签名要求。原生冒烟通过 SQLite、PTY、语音桥、文件代理、Office 渲染器与文件监听。[签名核对](build/lo-existing-signature.log) · [成功日志](build/package-attempt-02.log)
- 封存源码和依赖锁哈希、包与关键原生资源哈希。包版本 0.1.5，Electron 42.11.14，ad-hoc 签名。[基线](build/baseline.txt) · [包哈希](build/package-sha256.txt)

## 启动驱动

- G01 初次启动时，macOS 的 Electron home 仍指向系统账号目录。身份检查拦下后续操作，未创建任务、未调用模型，确认进程正常退出。检查受影响的三处 Skills 目录时间戳，在该启动窗口内未发现条目或目录更新时间变化。[失败回执](M14-G01/attempt-001/result.json)
- 复用现有主进程入口隔离夹具，在 App 入口执行前重定向 Electron home，并按同一临时根校验包、HOME 和 userData 的真实路径。第二次确认身份匹配，打包 App 正常启动，可用实际设置控件开启新任务区；驱动随后在设置页寻找只存在于普通侧栏的入口，超时并正常退出。[首包截图](M14-G01/attempt-002/01-packaged-home.png) · [回执](M14-G01/attempt-002/result.json)

## 已取证的执行结果

- 独立模型线路通过。Claude SDK 在隔离 HOME 中使用真实 DeepSeek 完成新建、两轮续接与审批拒绝，拒绝后没有写入；Codex 使用独立 CODEX_HOME 和只读模式经 DeepSeek Responses 返回预期单词。Claude 测试走宿主服务，Codex 为 CLI 线路验证。[Claude 测试日志](M14-G01/model/claude-real-r.log) · [Codex 真实事件](M14-G01/model/events.jsonl)
- A57 在首包实测失败。显式文件协议链接未成为链接元素，`https://`、相对链接、裸路径对照均已保存；后续修复后重打包复验。[最小红测](M14-G04/attempt-002/A57-exact-red.json) · [失败截图](M14-G04/attempt-002/A57-failed.png)
- A37 验证同一任务切换 Provider 后保留浏览器页签与合成登录态；A58 已核对重复点击不覆盖编辑、找不到文件与符号链接越界提示、PDF 渲染与原文不变。实际用例剩余步骤仍待跑。详见 [G04 原始回执](M14-G04/attempt-002/result.json)。

- 首包启动升级了合成旧库，原有任务、运行、会话快照与文件哈希保留，外键完整，App 正常退出。A64 的升级失败回滚、旧包拒绝和业务 scope 另按用例验收。[升级结果](M14-G01/attempt-004/result.json)
- 首包真实回合通过。首页用实际设置、智能体控件及发送操作分别启动两端，收到预期回答并持久标记完成。隔离回环服务转发合成请求到真实 DeepSeek，包本身只收到本机公开测试令牌，真实测试 Key 不进 App。此批证明第三方线路的回合；X1 订阅和 C1/C2 账号隔离尚未完成。[实际记录](M14-G01/attempt-005/result.json)
- G03 首包通过 Git/普通目录的协作部分判据，覆盖默认为共用目录排队、可信读并行、显式工作副本使用 HEAD、关系卡和结果回父。Claude 2.1.327 未验证业务桥，普通对话正常；用明确受支持版本另复验业务桥。[委派批次](M14-G03/evidence-batch01/README.md)
- 已完成回合后的正常退出超时跨 G01/G03/G04 复现，记录为 M14-D06-02。G01 实包在两任务都 completed 后进入 before-quit，25 秒未退出且未见提示框；本轮隔离进程随后由驱动回退终止。空闲未开运行的启动样例和旧库启动样例均正常退出。[退出追踪](M14-G01/attempt-005/quit-trace.jsonl)

## 退出超时复核

同一 Electron Node 模式的独立对照显示，`--inspect-brk` 传给 Worker 时后台线程启动超时，显式去掉它后同一 Worker 正常完成。M14 私有入口夹具只去掉这个测试参数，生产包字节一致。原包按相同两端真实 DeepSeek 流程再次跑通，正常退出 code 0。M14-D06-02 归类为验收驱动问题，原超时保留。[差分对照](M14-G01/attempt-008/worker-inheritance.log) · [同包复验](M14-G01/attempt-008/result.json) · [退出事件](M14-G01/attempt-008/quit-trace.jsonl)

G04 的 A38 已增加真实文件引用、切换保留草稿与冲突恢复；A73 实测四面板切换和首页入口。主题／窄窗与 A65 捕获暂未复验，见 [原始批结果](M14-G04/attempt-003/dispatch-evidence.json)。

- A43／A78／A79 已在首包核对跨任务草稿保留、归档与撤销、设置页只读打开和恢复，以及项目删除两个任务（含一个已归档）且保留原代码文件。正常退出。整条还需补各个并发、归档组和阻塞判据。[实包记录](M14-G02/attempt-001/result.json)

## 候选包 4d1468480

A57 增加显式本机文件链接的渲染测试，裸文件地址、远程 file URL 与危险协议保持纯文本，打开文件继续走既有宿主授权校验。定向红测与 48 项绿测均已归档。隔离 Git 工作树的前两次打包分别缺已跟踪插件文件及 M12 映射；核对并补齐生产所需的原生、许可及 M9/M12 固定输入后，完整构建和六项原生冒烟通过。候选验收正在执行。[成功构建日志](build/candidate-4d1468480/package-attempt-03.log) · [哈希](build/candidate-4d1468480/package-sha256.txt)

- 基线广域回归 3530 项通过，7 项失败，16 项跳过。原失败分布为业务浏览器／邮件超时和 Codex 私有原生服务收尾，两组端到端同条失败日志均保留。无打包负载时串行复跑原 7 条（过滤额外选中 1 条同类参数）全部通过；修复后受影响的 72 项测试、类型检查通过。[首次软件回归](software/agent-and-business-test.log) · [原失败复验](software/software-red-selective-rerun.log) · [定向 72 项](software/affected-final.log)
- G03 候选四次均退出 0。Claude 2.1.326 与 Codex 0.169.0 双向委派、三种目录里独立任务并行、独立工作副本离线 npm 安装、Codex 原生写入与宿主提交获实包证据。该组使用合成模型。[G03 候选核心](M14-G03/evidence-candidate-core/README.md)
- A65 在修正夹具后复验 Git 和 SVN。查看实际轮次的差异、主 Git HEAD 和脏索引保持、SVN wc.db 哈希保持、草稿不串均通过。压力与回收余项保留。[A65 候选](M14-G04/candidate/attempt-001/A65/result.json)
- A75 候选在实际输入框拖入项目内文件与外部图片。选择明确支持 image 的合成模型，图片原件、独占冻结副本和真实 Codex 发到模型线路的 PNG 三份 SHA-256 完全相同，回合完成且 App 正常退出。系统剪贴板和其余附件矩阵未计通过。[附件实包证据](M14-G02/attachment-candidate/result.json)
- A57 候选已有显式本机 file URL 渲染绿测，普通和 file URL 的点击定位仍待诊断。没有用整条通过覆盖首轮失败。[A57 候选点击证据](M14-G04/candidate/attempt-002/A57/result.json)

### 后续实测

- A57 在正式消息中点开了显式 file URL 并定位到第 3 行。localhost、相对路径、目录、历史路径与显式根外路径也有实测记录。跨行裸路径需要换用实际的行内命中矩形再补测。[点击与定位](M14-G04/candidate/attempt-004/A57/result.json)
- A77 完成排队与交接。Git、SVN 和普通目录中，子任务收到上一位实际写入者的三文件清单及重读提醒；没有完整快照时明确提示未知。两条相关集成回归通过。[三类目录和无记录对照](M14-G03/evidence-candidate-supplement/README.md) · [软件回归](software/a77-handoff-layers.log)
- A26 两个 Claude 子任务提出同文问题，父面板的两份答案分别抵达各自的原生任务。权限继承及其他请求类型仍有缺项。[同文问题实测](M14-G03/evidence-candidate-supplement/attempt-014/result.json)

## 候选包 fef791bc6

已从 `fef791bc65cc7e82d1b83606a26b67714e99328d` 构建新的隔离包，六项原生冒烟通过。旧候选仍保存在本轮临时根。三项界面修复均保留组件层原红测，受影响范围 117 项及类型检查通过。[构建与签名](build/candidate-fef791bc6/package-fef791bc6.log) · [包哈希](build/candidate-fef791bc6/package-fef791bc6-sha256.txt) · [回归结果](software/ui-interaction-regressions/a38-a73-a74-green.log)

| 缺陷 | 旧候选实测 | 修复 |
| --- | --- | --- |
| M14-D06-03 / A38 | [邮件原引用未写入草稿](M14-G04/candidate/attempt-003/A38-mail/result.json) | 等待目标任务的可编辑输入框及已加载草稿后插入，检查任务和项目身份。 |
| M14-D06-04 / A73 | [启动时关闭抽屉后 shell 仍在](M14-G04/candidate/attempt-003/A73/result.json) | 对本次启动回执返回的终端键发出关闭，等待关闭完成后再收起。 |
| M14-D06-05 / A74 | [关系卡与原生子抽屉同时出现](M14-G03/supplement-a74/result.json) | 打开原生子抽屉时收起关系卡。 |

A38、A73 早关和 A74 的失败路径均已在此包实测关闭。A57 结合 U／I 和实包全组通过。A13 使用合成旧库和两个原生绑定，重启后旧行、业务快照与文件原样保留，新任务区没有旧入口。[A38](M14-G04/fef791bc6/attempt-005/A38-mail/result.json) · [A73 早关](M14-G04/fef791bc6/attempt-005/A73-early-terminal/result.json) · [A74](M14-G03/evidence-fef791bc6-drawers/result.json) · [A57](M14-G04/fef791bc6/attempt-005/A57/result.json) · [A13](M14-G02/legacy-data-fef791bc6/result.json)

- 两个执行器通过本机合成模型实际触发宿主邮件草稿审批，分别批准后各生成一份草稿并唤醒原任务。Codex 审批保留超过 61 秒，回合已经结束。首次 Codex 完成全部业务判据后截图超时，Claude 独立续测并成功取证。[Codex 回执](M14-G01/business-codex-fef791bc6/result.json) · [Claude 回执](M14-G01/business-claude-fef791bc6/result.json)
- A45 保存并读回 1,245,077 字节的正文文件，SHA-256 与原文一致，删除测试文件后的展开明确报错。写入故障判据在首次驱动中未展开当前条目，已经保留现场并修正驱动。[首次结果](M14-G02/long-content-fef791bc6/result.json)
- A64 实包跑完旧库升级、迁移失败回滚和拒绝较新数据库，业务运行身份矩阵仍缺。A65 复验 52 个写入回合和 53 条轮次记录，Git HEAD 与用户 index 均未改。[A64](M14-G04/fef791bc6/attempt-007/A64-results.json) · [A65](M14-G04/fef791bc6/attempt-009/A65-pages/result.json)
- A80、A83、A27 的本机原生执行与合成输入补证均已收录，真实账号与崩溃恢复尚未覆盖。A19 的真实模型外部网关在进程启动前被自动审批拦截，原因是缺少明确的测试目的地授权。[本机协作补证](M14-G03/evidence-fef791bc6-local-collaboration/README.md) · [审批记录](M14-G03/evidence-fef791bc6-real-delegation/README.md)

## 候选包 5d211c705

- M14-D06-06 / A29。实包捕获到 Escape 键，原生子 Agent 抽屉仍然显示。`396bf74c4` 增加 Esc 关闭，同时保留输入法组合态和正在处理 Escape 的上层控件。组件绿测 71 项，待新包复验。[实包原始失败](M14-G03/evidence-fef791bc6-drawers/result.json) · [软件回归](software/drawer-escape/a29-affected-green.log)
- M14-D06-07 / A73。实包中子工作副本实际写入并提交文件，两个快照却都为空树。`5d211c705` 仅对该任务已登记的真实工作副本调整宿主目录排除，继续保护应用数据。配套红测又确认，从仓库子目录查看差异时原列表有项，但正文为空；修复后从同一登记工作树根按字面路径读差异。受影响范围 55 项软件回归通过，1 项独立真实环境检查跳过。[实包空树反例](M14-G04/fef791bc6/attempt-008/A73-worktree-diff-red.json) · [原红测](software/worktree-diff/a73-worktree-red.log) · [子目录红测](software/worktree-diff/a73-worktree-first-green.log) · [绿测](software/worktree-diff/a73-worktree-final-green.log)
- 从 `5d211c705abc36f1b428e1e129c47989c360f667` 完成隔离构建与六项原生冒烟。新一轮复验进行中。[构建日志](build/candidate-5d211c705/package-5d211c705.log) · [包及原生文件哈希](build/candidate-5d211c705/package-5d211c705-sha256.txt)

`5d211c705` 的 Esc 与工作副本原缺陷均已复验。原生抽屉实点关闭和 Esc 均可用，左侧仍可导航。根目录与映射子目录的父、子差异正文、原文和增删行数正确，工作副本独立，包含方括号的文件名按字面定位。同名文件绝对与相对链接都在子目录打开。已修正未保存缓冲测试的独立保存门闩，待下一批执行。[Esc 与特殊文件名](M14-G03/evidence-5d211c705-regressions/README.md) · [工作副本子目录界面](M14-G04/5d211c705/attempt-013/result.json)

## 候选包 a88ae2016

从本地提交 `a88ae2016252e68316cf04fb2f88459b4e766467` 打包，六项原生冒烟、308 项受影响测试和类型检查通过，7 项独立前置未启用并保持跳过。[构建](build/candidate-a88ae2016/package-a88ae2016.log) · [包及原生资源哈希](build/candidate-a88ae2016/package-a88ae2016-sha256.txt) · [软件回归](software/stop-and-artifact/stop-and-artifact-final-green.log)

- M14-D06-08 / A27、A05。旧包点一次「停止任务树」会先关闭父进程，随后把已停止的回合标为失败。另用实际 Codex 的测试代理丢弃中断回执，旧包仍立即开始关闭，按钮未等到 10 秒。修复在协调排空前发出原运行中断，后台等待所有在途工作，两个驱动仅把已请求中断的对应回合记为停止。新包的强停已按原始控件与同一进程出生身份核对，超时不会自行关闭，点击后保留占用直到原进程退出。[Claude 原始失败](M14-G03/evidence-5d211c705-regressions/attempt-026/result.json) · [Codex 原始失败](M14-G02/force-red-5d211c705/result.json) · [实包强停通过](M14-G02/force-a88ae2016/result.json)
- M14-D06-09 / A45。测试让私有正文根无法建目录，旧包清理临时文件时同样失败，整条回答未保存。新包保留结构化前缀，展开后明确说明后续无法恢复，回合、应用均正常结束。独立流式停止子判据因合成流尚未表现为可见正文超时，保留该结果。[旧包磁盘故障](M14-G02/long-content-5d211c705/result.json) · [隔离新包复验](M14-G02/long-content-a88ae2016/result.json)

## 候选包 10b3190e3

本轮打包纳入 D06-10。六项原生冒烟、155 项受影响测试和类型检查通过，1 项独立真实环境用例跳过。[构建日志](build/candidate-10b3190e3/package-10b3190e3.log) · [包及原生资源哈希](build/candidate-10b3190e3/package-10b3190e3-sha256.txt) · [软件回归](software/drawer-owner-state/a29-owner-status-green.log)

- M14-D06-10 / A29。更新用原生子节点生命周期显示状态，停止动作绑定打开抽屉时所属运行。三视口均在实际子节点工作期间显示「工作中」，历史抽屉在新运行期间没有停止入口，提交旧运行 ID 也确实被拒。独立用例实际下发停止，原回合为 interrupted，原进程正常退出。[历史与三视口](M14-G03/10b3190e3/attempt-032/result.json) · [精准停止](M14-G03/10b3190e3/attempt-034/result.json)
- A73 的子目录补证使用 `a88ae2016`，在真实 UI 保留两处未保存的缓冲，分别落盘，右键动作把对应工作副本绝对路径送入隔离渲染器的复制接口。[映射子目录](M14-G04/a88ae2016/attempt-016/result.json)
- M14-D06-11 / A37、A64。使用 `a88ae2016` 的打包 App 产生正常邮件批准与本地草稿，浏览器授权未到宿主。真实 Codex 0.169.0 与同一打包 CLI 的隔离对照复现原连接失败，选用宿主此前已准备的命名权限后，登记套接字可达，限制档位下未登记套接字仍阻断。等价的恢复线程对照也已完成。打包 App 业务批准复验仍待完成。[邮件来源](M14-G04/a88ae2016/attempt-018/mail-scope-independent-proof.json) · [启动对照](M14-G04/codex-cli-socket/thread-start-legacy-vs-named.json) · [恢复与档位对照](M14-G04/codex-cli-socket/tier-and-resume.json)
- A27 隔离故障注入，在同一临时数据上重启应用，原 Claude PID 退出、旧原生请求退役、正在发送的回合显示接收未知。排队输入等到用户实际操作才在新运行中派发。已记录第一轮隔离开关尚未持久的夹具失败。外部业务效果未知仍待隔离 SMTP 专项核对。[夹具首轮](M14-G03/10b3190e3/attempt-033/result.json) · [重启复验](M14-G03/10b3190e3/attempt-035/result.json)
- M14-D06-12 / A29、A05。Codex 父回合中断成功时，原生子仍在运行，停止计时却消失，无法按规则手动强停。两项回归已覆盖父回合先结束、子任务自然结束或在用户点强停时结束。修复提交 `1c9022486`，实包待复验。[实包红测](M14-G03/10b3190e3/attempt-036/result.json) · [软件红测](software/codex-cli-and-drain/a29-child-drain-red.log)
- A45 本机真实 Codex 分段发送 Unicode，响应仍保持打开时点击停止，回合收口、原响应关闭、应用正常退出。A71 完全访问下实际展示 Claude 计划请求，确认前未写入，确认后同一轮完成一项指定写入。继续修改、拒绝和真实模型等判据另验。[流式停止](M14-G02/10b3190e3/attempt-012/result.json) · [完全访问批准](M14-G02/10b3190e3/attempt-016/result.json)

## 候选包 1c9022486

包含 D06-11 与 D06-12。六项原生冒烟、315 项受影响软件回归通过，另有 7 项既有真实环境前置跳过；私有套接字启动模块的新增集成测试通过。默认工具沙箱首轮不允许启动测试所需的私有应用通道，保留原报告，单项在允许该本机资源的执行模式中通过。现分别复验原生浏览器授权和 Codex 所属运行强停。[构建日志](build/candidate-1c9022486/package-1c9022486.log) · [包及原生资源哈希](build/candidate-1c9022486/package-1c9022486-sha256.txt) · [Agent 和渲染端回归](software/codex-cli-and-drain/a64-a29-agent-full.log) · [启动器集成](software/codex-cli-and-drain/a64-launcher-native.log) · [框架初次失败](software/codex-cli-and-drain/a64-permissions-first-green.log)

- A64 完整通过。此前实包的保留旧数据、升级故障回滚和旧包拒用新库已有证据。`1c9022486` 复验现有任务的独立运行身份，邮件、本机插件和浏览器在经过真实 UI 后分别完成。同一新任务具有两个独立绑定，旧 PTY 负例被拒。浏览器访问原生路径从失败转为获批后实际读取本机合成页，关闭 D06-11 在现行 Codex 0.169.0 的反例。[A64 结果](M14-G04/1c9022486/attempt-020/result.json) · [数据库核对](M14-G04/1c9022486/attempt-020/scope-database-proof.json) · [进程收尾](M14-G04/1c9022486/attempt-020/cleanup.json)
- A29 完整通过。真实 Codex 原生子在父轮停止后仍运行，10 秒强停入口在正确时间出现，用户实际点击后结束准确进程，未触发排队消息。该版本的原生子提问工具明确只允许根线程；Claude 的 general-purpose 原生子未公布提问。两种执行器作父任务均验证宿主子申请及应答走独立来源。[A29 合并证据](M14-G03/evidence-1c9022486-a29-final/README.md) · [Codex 原生工具回执](M14-G03/evidence-1c9022486-a29-final/attempt-038/native-tool-matched-receipt.json)

[本人协作待验](本人协作待验.md) 仅维护当前确实需要账号授权、本人系统操作或样本确认的前置。其余独立用例继续按用例分配执行。

- 已从 `1c9022486` 实物包核对 SDK 依赖与平台库存，重新执行 M14 原型 30 项、固定 T3 版本的研究回放 34 项、新录制待办／目标回放和类型检查。研究和原型结果不记正式产品用例通过。[包库存](M14-G02/1c9022486/inventory/result.json) · [类型检查](software/independent-1c9022486/typecheck-1c9022486.log) · [原型回归](software/independent-1c9022486/m14-prototype-1c9022486.log) · [固定录制回放](software/independent-1c9022486/a59-fixed-research-replay.log) · [新录制回放](software/independent-1c9022486/a59-new-research-replay-final.log)

- M14-D06-13 / A26。冻结 `1c9022486` 的实际任务与委派服务中，父任务已经升档，子任务下一轮仍收到旧档位。Claude 不能使用 Codex 的「帮我批准」时实际降档正确，父子账中缺少降级理由。以真实 Store 和任务服务取证，原生发送用受控替身记录档位；该批是 I 层。[反例](M14-G03/1c9022486/a26-inheritance-red/baseline.log)
  独立源码副本已修复子轮派发、父档即时裁定插件写、子不单独授权和降级说明。六项精确集成测试及四项拟入库的回归通过，类型通过。最初正式回归测试假定新回合一定沿用同一进程，已按同一逻辑子任务和实际派发矫正。候选 `1c9022486` 继续冻结给运行中 M13，修复未进入该包。[完整红测](M14-G03/1c9022486/a26-inheritance-red/baseline-all.log) · [集成绿测](software/delegation-tier/a26-private-green.log) · [首轮测试记录](software/delegation-tier/a26-official-private-green.log) · [回归复验](software/delegation-tier/a26-official-private-recheck.log)

M13 全量在 `1c9022486` 冻结基线使用本机单 worker 核验，153 文件中 148 通过、5 条件跳过。2,377 项通过、9 项按原条件跳过、零失败。这个结果覆盖浏览器 CLI 权限和原生停止修复。A26 在独立源码副本验证，尚未进入此产品基线。[M13 全量回归](software/codex-cli-and-drain/m13-full-1c9022486.log.gz)

D06-13 修复已提交为 `84ab51651`，工作区 321 项回归与类型检查通过。当前隔离 App 仍使用 `1c9022486` 跑无关场景。项目、侧栏、归档设置合计 90 项通过，首轮 SSH 夹具遇到沙箱拒绝本机监听，单项用仅本机临时 SSH 的执行模式复跑通过。[A26 回归](software/delegation-tier/a26-affected-main.log) · [项目初次回归](software/independent-1c9022486/a78-a79-software-1c9022486.log) · [SSH 单项复跑](software/independent-1c9022486/a78-project-transfer-loopback.log)

- M14-D06-14 / A78。`1c9022486` 的项目只含未归档的新任务，实际还有空闲原生会话及打开的已完成差异。新任务阻塞列表为空，确认框却误报一个旧终端。旧计数路径使用了包含原生业务运行的共享统计。集成测试同时加入真旧任务，预检原先把两类都算为旧终端。修复只调整项目删除计数的作用域，保留其它应用的共享统计。[实包红测](M14-G04/1c9022486/attempt-029/A78-idle-native-legacy-count-red.json) · [集成红测](software/project-legacy-counter/a78-legacy-counter-red.log)
- A79 已归档项目通过真实确认，设置页依原项目分组，任务历史、附件名和冻结副本字节均保留，App 退出 0。父子组合仍待独立复验。[归档项目](M14-G04/1c9022486/attempt-028/result.json)

- M14-D06-15 / A45。实际打包 App 加载 Unicode 流，预览帧最大 120,180 字节，超出 32 KiB。受控慢窗口收到 31 个原始帧。产品修复将实时预览按每运行合批，并按序列化字节切帧，收到回合终态立即清理待发预览。其余 A45 容量和恢复判据仍分层验证。[实包红测](M14-G02/1c9022486/stream-capacity-red/result.json)

## 候选包 70ccb0922

统一从提交 `70ccb0922` 构建，纳入 D06-13、D06-14、D06-15。实物包及六项原生冒烟通过。当前生产输入的 Agent 和渲染端受影响回归 324 项通过、7 项条件跳过，类型检查通过。[构建日志](build/candidate-70ccb0922/package-70ccb0922.log) · [包和原生组件哈希](build/candidate-70ccb0922/package-70ccb0922-sha256.txt) · [软件回归](software/live-output-bound/a45-live-budget-green.log) · [类型检查](software/live-output-bound/a45-live-budget-typecheck.log)

- D06-15 实包复验通过。受控慢窗口收到 5 帧，最大 32,743 字节，合并后 159,681 字节与完整 Unicode 原文相同。模型流保持打开时点击停止，120 毫秒内收口，测试 App 退出 0。A45 历史分页和跨任务容量矩阵继续验。[实物包结果](M14-G02/70ccb0922/attempt-018/result.json) · [停止截图](M14-G02/70ccb0922/attempt-018/06-A45-stopped-while-streaming.png)

- 上一候选的 A24 原生调用已精确匹配到通道故障回执，正文未暴露。旧驱动把委派说明误判为返回正文，使用原记录复放确认新的精准判据。A27 邮件分支在保存临时账号时触发 macOS 钥匙串授权；同一结果记录同时包含本机 SMTP 前置失败和独立复验边界。[A24、A27 取证](M14-G03/evidence-1c9022486-business-transport/README.md)

- D06-14 实包正反两例通过。空闲 M14 原生进程退出后项目可删除，打开差异的查看租约没有阻塞。使用真实旧任务入口启动的独立 PTY 仍在时确认框报告一个旧终端，保留原项目与 PTY。两次隔离 App 均正常退出。[空闲新任务](M14-G04/70ccb0922/attempt-030/result.json) · [活跃旧终端](M14-G04/70ccb0922/attempt-033/result.json)

- M14-D06-16 / A79、A78。父子结果已送达且任务已经空闲，归档初检通过，关闭父执行器时产生的写入槽交接仍在核验，归档立刻重检报错。父子均未归档。集成层复现相同的归档和项目删除问题，真实关闭及进程、后代、业务的排空校验是释放写入资格的前置。[实包时间线和账本](M14-G04/70ccb0922/attempt-032/A79-family-archive-drain-red.json) · [实包提示](M14-G04/70ccb0922/attempt-032/A79-family-failed.png) · [集成红测](software/archive-ownership/a79-drain-combined-red.log)

- A76 初次实包能力探测中，本机 Claude 没有向合成模型公布 TaskCreate、TaskUpdate 或 TodoWrite。驱动未调用未公布的工具，App 退出 0；已有研究回放仍按 R 层记录。[本轮结果](M14-G02/70ccb0922/a76-capability/result.json)

D06-16 修复已本地提交 `891e51568`。归档、删除会等本次主动关闭引起的同一运行收口，再做原有检查。四条回归均验证等待期间保留原任务及占用。两条确认退出的允许操作，两条退出不明的拒绝操作。106 项受影响回归与类型检查通过，1 项条件跳过。[软件复验](software/archive-ownership/a79-drain-combined-green.log) · [类型检查](software/archive-ownership/a79-drain-typecheck.log)

A78 清理重启子判据通过。本轮私有冻结附件因目录权限收到真实 EACCES；项目已删除，仍在的副本哈希一致，持久重试次数为 1。恢复测试目录权限且达到原重试时间后，重启同一数据，副本、空目录和重试行均消失，未登记的对照文件保持原哈希。两个 App 正常退出。[故障注入](M14-G04/70ccb0922/attempt-035/A78-cleanup-injection.json) · [失败账](M14-G04/70ccb0922/attempt-035/A78-cleanup-pending.json) · [恢复](M14-G04/70ccb0922/attempt-035/A78-cleanup-restart-result.json)

D06-16 源码候选的 Agent 与任务界面受影响回归共 325 项通过，7 项原条件跳过；实包正在统一构建。[适用软件回归](software/archive-ownership/a79-drain-affected.log)

## 候选包 891e51568

构建与六项原生冒烟通过，包含 D06-16。先实包复验父子归档、恢复及删除组合。[构建日志](build/candidate-891e51568/package-891e51568.log) · [包和原生组件哈希](build/candidate-891e51568/package-891e51568-sha256.txt)

- A79 完整通过。真实父子归档、撤销、整组设置恢复、归档历史和只读差异、五种宿主写入拒绝、恢复后沿用原生会话及单独归档／恢复子任务均通过。已归档项目与冻结附件由独立实包覆盖。D06-16 的父子归档反例关闭。[归档与续聊](M14-G04/891e51568/attempt-039/result.json) · [只读差异](M14-G04/891e51568/attempt-039/A79-archived-child-history-and-diff.png) · [已归档项目](M14-G04/1c9022486/attempt-028/result.json)

- M14-D06-17 / A20。冻结候选的 I 层读取目标目录后，只改同一有效档案名称，旧委派静默按新修订被接受并创建新子任务。代码已按查询修订比对并跨异步准备、原生派发复查。同一已接受请求键仍返回原结果。定向三项通过，Agent 与渲染端 328 项通过、7 项条件跳过，类型检查通过。[冻结反例](software/target-revision/witness.json) · [定向绿测](software/target-revision/a20-profile-revision-green.log) · [受影响回归](software/target-revision/a20-profile-revision-affected.log)

- A78 实包组合删除通过。实际确认的任务清单有 3 个任务，其中 1 个已归档。备份路径无需移动，原生历史、旧业务调用、代码和工作副本等保持，登记引用和冻结附件删除。独立影子库及非空已决请求专项随后验证。[确认框](M14-G04/891e51568/attempt-041/A78-composite-delete-confirmation.png) · [物理和数据库结果](M14-G04/891e51568/attempt-041/result.json)

- M14-D06-18 / A44。以真实 App 点击“加载更早的记录”两次，原 IPC 只延迟回包，两个游标 88 依次进入实际处理器。界面出现同一历史条目两次。提交 `ba735fbe1` 拒绝同一等待中的分页，并按修订合并来自历史与快照的同一条目。两条组件反例转绿，330 项受影响回归通过，7 项原条件跳过。后续仍有事件缺号和恢复等独立判据。[实包红测](M14-G02/891e51568/attempt-022/result.json) · [截图](M14-G02/891e51568/attempt-022/duplicated-history-row.png) · [组件红测](software/history-paging/a44-history-paging-red.log) · [受影响回归](software/history-paging/a44-history-paging-affected.log)

- A78 完整通过。普通目录实点批准一次后发生文件更改，删除前存在实际不同的影子树、登记引用和已决请求。确认删除后私有影子库、引用、已决请求和追踪记录消失，用户源文件字节保持，原目录不新建 `.git`。已有组合、逐项拒绝和清理故障重启的正式证据。[影子库删除](M14-G04/891e51568/attempt-042/result.json) · [Git 组合](M14-G04/891e51568/attempt-041/result.json) · [清理重启](M14-G04/70ccb0922/attempt-035/A78-cleanup-restart-result.json)

## 候选包 ba735fbe1

冻结提交 `ba735fbe1` 并重新构建。六项原生冒烟通过，包含 D06-17 与 D06-18。[构建日志](build/candidate-ba735fbe1/package-ba735fbe1.log) · [包和原生组件哈希](build/candidate-ba735fbe1/package-ba735fbe1-sha256.txt)

- D06-18 实包复验通过。同样实际点击两次且原 IPC 回执仍延迟，只收到一次游标 88 请求，历史行只渲染一次，App 退出 0 且无渲染错误。A44 的事件补拉和恢复仍待验。[实包复验](M14-G02/ba735fbe1/attempt-023/result.json) · [界面截图](M14-G02/ba735fbe1/attempt-023/one-history-row.png)

- A76 Codex 独立实包负例通过。在没有公布清单或 plan 工具的实际 Codex 会话里，以纯文本清单作答时未生成结构化卡片。Claude 的原生正例依赖执行器当前公布工具的运行。[Codex 实包](M14-G02/ba735fbe1/attempt-024/result.json) · [界面](M14-G02/ba735fbe1/attempt-024/codex-no-todo-from-text.png)

- D06-17 实包反例关闭。Claude 原生查目录，真实设置只改目标名称，旧版本原生调用明确被拒且没有子任务。重新查询并换请求键受理，旧版本重投已接受键仍返回相同收据，真实 Codex 子只派发一轮。App 退出 0。新增本地提交 `9f3b8b7fd` 只补了工作副本准备窗口的测试，继续复用生产包；定向合计五项通过。受理后窗口的实包补证继续。[实包证据](M14-G03/evidence-ba735fbe1-a20-directory/README.md) · [定向测试](software/target-revision/a20-profile-revision-closure.log)

- D06-19 / A74。1000×760 下关系卡与右侧文件面板同开，返回主任务按钮由宽屏 24px 高变成 Git 114px、SVN 60px。停止控件的中心命中其他元素。已完成子任务的汇总卡显示耗时，关系卡漏显示。提交 `1a51e11c3` 按实际容器宽度紧凑排版，返回和操作按钮保持单行，长标题与模型截断，补充用时和可核实的工作副本合并状态。[Git 窄窗](M14-G04/ba735fbe1/attempt-047/04-branch-running-narrow-right.png) · [SVN 窄窗](M14-G04/ba735fbe1/attempt-048/04-reader-running-narrow-right.png)

- D06-20 / A74。真实共用目录写入子任务取得写入槽，父任务收到另一子结果后排队，宿主把尚未派发的写入所有者当作空闲。Git 在原生创建前失败，SVN 在注册后首轮前退出，两者均未发到合成模型。定向集成反例覆盖这两个窗口，另证真实空闲的竞争者仍会交出。合入 `1a51e11c3` 后 334 项通过、7 项原条件跳过，类型检查通过。[Git 时序](M14-G04/ba735fbe1/attempt-047/readonly-event-summary.json) · [SVN 时序](M14-G04/ba735fbe1/attempt-048/readonly-event-summary.json) · [集成红测](software/lineage-writer/a74-writer-admission-red.log) · [集成绿测](software/lineage-writer/a74-writer-admission-green.log) · [受影响回归](software/lineage-writer/a74-admission-layout-affected.log)

- D06-21 / A44。组件层复现旧页不随缺失的变更刷新，以及事件已裁剪却继续显示旧页。提交 `7593e436b` 按捕获水位补拉、遇裁剪重新采用权威快照。历史页必须匹配任务和游标，旧修订按当前数据重新核对。事件、正文仍用原 IPC 字节边界。受影响回归 337 项通过和 7 项原条件跳过，类型检查通过。真实窗口恢复和缓存裁剪等待同候选复验。[组件红测](software/history-event-recovery/a44-event-sync-red.log) · [软件绿测](software/history-event-recovery/a44-event-sync-candidate.log) · [实包驱动](software/history-event-recovery/history-sequence-resync.mjs)

M13 在 `ba735fbe1` 的首次复跑由隔离工作树启动，但缺少 `out/capability-bundles-compatibility-v1/index.json`。该目录由正式的 `pnpm test:prepare` 生成，发布构建只准备正式 bundle，应用启动测试在缺夹具的准备步骤退出。已停止本轮唯一 Vitest 子进程，退出码 130。该轮不作为产品通过或失败证据；下一候选先运行官方准备命令和单项前置，再跑全量。[首轮软件记录](software/m13-final/full-ba735fbe1-missing-compatibility-fixture.log)

- A20 完整通过。在真实普通项目排队接受后改名，父回合自然结束、旧子无原生启动；独立 Git 工作副本里在实际离线安装期间改名，安装可结束，过时子请求随即被拒。旧收据的任务、请求键和冻结修订保持，父收到明确的失败结果；两个 App 均退出 0。和普通目录查询、原生受理与去重，以及凭据身份修订的集成证据共同覆盖。[查询及重复回执](M14-G03/evidence-ba735fbe1-a20-directory/README.md) · [待派发](M14-G03/ba735fbe1/attempt-047/result.json) · [准备期间](M14-G03/ba735fbe1/attempt-048/result.json)

## 候选包 7593e436b

冻结 `7593e436b`，原生冒烟六项通过。包含写入子任务启动占用、任务关系卡窄窗、历史补拉和历史游标修复。[构建日志](build/candidate-7593e436b/package-7593e436b.log) · [包和原生组件哈希](build/candidate-7593e436b/package-7593e436b-sha256.txt)

- A74 实包关闭。Git 同一项目的共用目录和工作副本，以及 SVN 只读和写入子任务，均从真实关系入口在运行和完成时逐个点开。1440×900 与 1000×760 下，关系卡和文件面板同时打开时，停止、返回和关系入口命中，长名称／模型保持单行。Git、SVN 实包重放两种取得目录槽的时序，写入子任务都完成原生首轮。真实未合入的分支最终仅在工作副本区显示“需要你处理”，该补充驱动误等父任务完成，原结果保留。[Git](M14-G04/7593e436b/attempt-049/result.json) · [SVN](M14-G04/7593e436b/attempt-050/result.json) · [未合入补证](M14-G04/7593e436b/attempt-052/result.json) · [关系卡和原生抽屉互斥](M14-G03/evidence-fef791bc6-drawers/result.json)

- D06-22 / A44。前两次实包驱动分别停在标记格式与不适用的网页可见性前置。改为确认原生窗口已隐藏后，旧包确实漏掉已提交但未推送的序号 4。首个修复包 `333b163e5` 的跟踪显示，macOS 后台重显可能没有原生 show 事件，网页仍始终报告可见。[驱动前置失败 026](M14-G02/7593e436b/attempt-026/result.json) · [027](M14-G02/7593e436b/attempt-027/result.json) · [旧包真实红测](M14-G02/7593e436b/attempt-028/result.json) · [首个修复包跟踪](M14-G02/333b163e5/attempt-030/result.json)

## 候选包 216acf6a7

冻结 `216acf6a7`，六项原生冒烟通过。[构建日志](build/candidate-216acf6a7/package-216acf6a7.log) · [包和原生组件哈希](build/candidate-216acf6a7/package-216acf6a7-sha256.txt)

- A44 完整通过。对自己的隔离窗口运行真实 App 重开回调，夹具用不夺系统焦点的重显代替原生聚焦动作。窗口发出恢复通知，真实读取了序号 (3,4] 并更新旧页。裁剪后的序号范围触发重取，同一历史请求跨任务迟到时不污染新视图，实际页面重载后重新查询并显示最新修订。App 正常退出，无渲染错误。本轮为后台 A 证据。[实包结果](M14-G02/216acf6a7/attempt-031/result.json) · [恢复后](M14-G02/216acf6a7/attempt-031/02-restored-tail.png) · [重连后](M14-G02/216acf6a7/attempt-031/05-reconnected.png) · [定向测试](software/history-event-recovery/a44-app-reopen-tests.log)

- D06-23、D06-24 / A43。实际候选 `333b163e5` 在原持久收据提交后丢回包，首页重试创建了两个逻辑任务、发出了两次原生请求。扣住同类晚回包时新增的文字被清空。实际单窗草稿 CAS 与独立竞争写入夹具证明，本地附件卡片仍可见但宿主已删除副本。两窗口 UI 判据继续保留。[重复](M14-G04/333b163e5/attempt-060/result.json) · [晚回包](M14-G04/333b163e5/attempt-062/result.json) · [冲突](M14-G04/333b163e5/attempt-063/result.json) · [首页组件红测](software/home-and-draft/a43-first-send-red.log)

- M13 已完成正式资源准备，上一轮因缺兼容夹具未执行的定向用例通过。单 worker 全量正在运行。[资源准备](software/m13-final/m13-final-prepare-216acf6a7.log) · [定向用例](software/m13-final/m13-final-preflight-216acf6a7.log)

- D06-23、D06-24 / A43 修复提交 `846b0b54c`。首页同一提交意图稳定复用任务与首轮键，过时回执结清后保留新的编辑与当前页面。草稿附件从被信任的编辑界面取得引用，竞争写入不能删除仍在使用的副本。360 项受影响测试通过，等待新包与 A43 双实际窗口前置。[受影响回归](software/home-and-draft/a43-a44-affected.log) · [协作与前置](本人协作待验.md)

- D06-25 / A59。固定 T3 转录研究回放 34 项通过，另对已结束的 `7593e436b` 实包原库做只读检查，真实委派只有旧式 subtask 记录，缺模型和绑定。提交 `a86cfaf1a` 让一次委派产生一条创建记录，确认原生绑定后更新同一条，并兼容旧条目显示；362 项受影响测试通过，等待实包。[研究回放](software/real-timeline-replay/timeline-replay.json) · [旧包只读核对](software/real-timeline-replay/old-package-delegation-projection.json) · [定向红测](software/real-timeline-replay/a59-thread-create-red.log) · [受影响回归](software/real-timeline-replay/a59-affected.log)

- A62 在 `216acf6a7` 实包确认 Codex 0.169.0 和 Claude 2.1.327 的本机发现、Codex 显式路径及恢复自动发现、缺路径／无执行权限／版本格式错误保留原设置。032 的导航选择器不适用于设置页；033 已运行到低版本拒绝，错误正文在折叠详情中，驱动尚未打开。两次均退出 0。[032](M14-G02/216acf6a7/attempt-032/result.json) · [033](M14-G02/216acf6a7/attempt-033/result.json)

- A48 完整通过。隔离候选 216acf6a7 走通父子任务同时归档、恢复及差异、图片副本、邮件草稿和原生绑定保留。活动、排队、请求及未收口子任务阻止归档。066 业务断言完成后遇到清场超时，已按原实例身份确认相关进程退出，其他实包轮次正常退出。[结果索引](M14-G04/216acf6a7/A48-216acf6a7-g04-evidence-index.json)
- A26 实包复验同一原生绑定的三代档位，以及父子四种档位组合和 Claude 降档说明。四类请求共存及撤销仍待验。[档位矩阵](M14-G03/216acf6a7/a26-050/README.md)
- M13 在 216acf6a7 跑全量，2,377 项通过，9 项按原条件跳过，1 项因稀疏工作树遗漏同提交的禅道测试夹具而失败。从同一提交校验并补齐夹具后重跑该文件，22 项全部通过。合并两轮得 2,378 项通过及 9 项跳过。[全量首跑](software/m13-final/m13-full-216acf6a7.log) · [同源夹具哈希](software/m13-final/m13-216acf6a7-zen-blob.txt) · [定向复跑](software/m13-final/m13-216acf6a7-zen-rerun.log)
- D06-26 / A62。原包单缺 MCP 和恢复两个可选方法就中止了基础对话。保存了原生调用、原库错误和驱动失败现场。修复提交 34135cb7f 使用隔离协议探测，软件回归 366 项通过，7 项按原条件跳过。待新包复验。[原包](M14-G02/216acf6a7/attempt-039/result.json) · [协议](M14-G02/216acf6a7/attempt-039/native-methods.jsonl) · [原库错误](M14-G02/216acf6a7/attempt-039/item-errors.json) · [受影响回归](software/a62/a62-affected.log)

## 候选包 031a216d0

冻结 031a216d0，六项原生冒烟通过。[构建日志](build/candidate-031a216d0/package-031a216d0.log) · [包和原生组件哈希](build/candidate-031a216d0/package-031a216d0-sha256.txt)

- A43 已完成四条实包复验，覆盖丢回执重试、迟回执保留首页晚编辑，以及单窗口冲突后的附件私有副本。真实双窗口与正在编辑另一任务的迟到回执场景待验。[复验索引](M14-G04/031a216d0/A43-031a216d-g04-evidence-index.json)
- A59 的 D06-25 实包反例已关闭。两次子任务创建各有一条记录，原生绑定确认后就地更新，带执行器、模型和工作目录模式。当前驱动复用了 A74 的实包委派场景。其余原生事件判据待验。[实包](M14-G04/031a216d0/attempt-074/result.json)
- A65 的 D06-27 原快照取消原因被覆盖。该包明确维持用户取消状态、未发布当轮引用。Git 捕获上限按逻辑尺寸触发，未实际写入 10 GiB。旧包已验证项目删除保留同前缀的未登记引用。回收侧已经见到私有引用释放和查看租约继续保护，点时间线入口后面板未于本次等待内切到已回收轮次，保存现场继续定位。[原取消失败](M14-G04/216acf6a7/attempt-068/cancel-old-reason-sequence.json) · [取消复验](M14-G04/031a216d0/attempt-075/result.json) · [超限](M14-G04/031a216d0/attempt-076/result.json) · [保留未登记引用](M14-G04/216acf6a7/attempt-069/result.json) · [回收现场](M14-G04/031a216d0/attempt-078/result.json)

## 候选包 34135cb7f

冻结 34135cb7f，六项原生冒烟通过。[构建日志](build/candidate-34135cb7f/package-34135cb7f.log) · [包和原生组件哈希](build/candidate-34135cb7f/package-34135cb7f-sha256.txt)

- A62 新包验证缺少 MCP 和恢复两个方法仍可对话，界面提示两项限制，退出后数据库记录与界面一致。040 的替身额外缺少普通任务发送宿主上下文所需的 thread/inject_items 也出现拒绝。041 已看到正常对话和提示，冷退出后 SQLite 普通读方式打开失败，独立不变文件回查成功。042 用只读方式重跑全部判据，App 退出 0。当前包实物库存确认 SDK 0.3.321、八个平台程序均未混入。[040](M14-G02/34135cb7f/attempt-040/result.json) · [041](M14-G02/34135cb7f/attempt-041/result.json) · [042](M14-G02/34135cb7f/attempt-042/result.json) · [库存](M14-G02/34135cb7f/inventory/result.json)
- A62 的 043 证实新环境两个程序都没找到时显示“安装后重新检测”并禁用入口。注入已安装程序的私有链接后，实际重检找到 Claude。Codex 测试用 PATH 当时缺了其脚本依赖的 Node，本机小复验可重复。此时只记缺失页面和一端重检通过，第二个入口用修正夹具复测。[缺失和重检现场](M14-G02/34135cb7f/attempt-043/result.json) · [缺 Node 复现](M14-G02/34135cb7f/attempt-043/a62-private-path-no-node.log) · [补齐后](M14-G02/34135cb7f/attempt-043/a62-private-path-with-node.log)
- A65 回收复验通过。079 新建真实普通目录影子库的两个快照。080 在标记逻辑用量达到阈值后留住正在查看的旧轮次，回收另一轮的已登记引用。两次真实点击均核对交付到目标改动卡，已回收的轮次显示清理原因。两个 App 都在原 PID 上退出 0。并发归属继续核对。[准备](M14-G04/34135cb7f/attempt-079/result.json) · [回收断言](M14-G04/34135cb7f/attempt-080/result.json) · [回收提示](M14-G04/34135cb7f/attempt-080/A65-actual-reclamation-notice.png)
- A59 补拍原生时间线时发现，当前投影没有呈现已列入合同的钩子、MCP 启动状态和 Codex 自动审批检查。修复 535b2cb1e 按原生身份更新同一条提示，迟到的钩子进度不恢复已终结状态。原始测试红测、125 项定向、368 项受影响回归和类型检查有记录，7 项条件跳过。待新包验证。[红测](software/real-timeline-replay/a59-lifecycle-red.log) · [受影响回归](software/real-timeline-replay/a59-lifecycle-affected.log)

- A62 完整通过。044 的模拟 PATH 缺少 Claude 和 Codex 时，真实设置提示安装并提供重检；补入既有执行器及 Codex 所需的 Node 后，真实重检找到两端。打包实物库存、权限内原生能力记录、冷启动与禁用可选能力一起组成 macOS arm64 本条证据。[044](M14-G02/34135cb7f/attempt-044/result.json) · [Claude 能力](M14-G02/34135cb7f/attempt-044/native-claude-sdk.json) · [Codex 能力](M14-G02/34135cb7f/attempt-044/native-codex-app-server.json)
- D06-28 / A65 重新打开。Git 与 SVN 实包已证明写入轮次内看得到工作区两个来源，后续只读查库发现同时运行的只读子任务也登记了同样的引用和改动卡。R09 要求捕获记录归属实际写入资格，原结论据此更正。保留 081–084 的夹具失败及真实写者已通过证据。[同一观察窗口](M14-G04/34135cb7f/A65-34135cb7f-g04-mixed-index.json)
- D06-29 / A45。用独立数据库预置 2,110 条历史，经真正的“加载更早的记录”按钮检验。单页数量和顺序正确，页面累计保留 2,110 条，超过技术方案的 2,000 条。隔离 App 正常退出。[分页容量反例](M14-G02/34135cb7f/attempt-045/result.json)

## 候选包 90acfe11f

冻结 90acfe11f，六项原生冒烟通过。包含 535b2cb1e 的原生时间线通知修复。D06-28 在本轮原生运行冻结只读身份，派发与终态均沿用该身份。测试覆盖并行写者的前后快照、权限升级仍保持原只读轮的归属，以及新写入轮有快照。269 项 Agent 回归通过，7 项按原条件跳过，类型检查通过。[构建日志](build/candidate-90acfe11f/package-90acfe11f.log) · [包和原生组件哈希](build/candidate-90acfe11f/package-90acfe11f-sha256.txt) · [红测](software/a65/a65-read-ownership-red.log) · [定向克服反例](software/a65/a65-read-ownership-focused.log) · [Agent 回归](software/a65/a65-read-ownership-affected.log)

- D06-28 / A65 整条复验通过。091 Git、093 SVN 的只读原生回合完成后，界面、原库及 Git 分别确认没有只读快照、记录卡和引用。写入轮次仍保留两来源的差异。092 实际写入后按停止，同一原生轮次中断，进程排空后真实捕获并打开后态。三轮 App 正常退出。[复验索引](M14-G04/90acfe11f/A65-90acfe11f-g04-recheck-index.json) · [写后停止](M14-G04/90acfe11f/attempt-092/result.json)
- A59 当前修复包查到实际 Codex 的四个 MCP 启动通知保存为四条，均更新到修订 2 和完成。其他原生事件仍在执行。[只读原库抽取](M14-G02/90acfe11f/a59-native/codex-mcp-startup.json)
- D06-29 修复提交 b58da7b89，将当前快照和已加载页合并计数及 UTF-8 大小。超限后较新一部分历史暂时收起，已有历史仍可重新读取。99 项渲染端测试与类型检查通过，实包的 2,110 条容量反例待重跑。[渲染端测试](software/a45-history/a45-renderer-history-affected.log) · [类型检查](software/a45-history/a45-renderer-history-typecheck.log)

## 候选包 9e41d1d29

冻结 9e41d1d29，六项原生冒烟通过。包含 b58da7b89 的历史容量修复。[构建日志](build/candidate-9e41d1d29/package-9e41d1d29.log) · [包和原生组件哈希](build/candidate-9e41d1d29/package-9e41d1d29-sha256.txt)

- A45 的 D06-29 实包反例已关闭。与 045 同样使用 2,110 条独立库历史，实际按“加载更早的记录”到达最早项，始终最多保留 2,000 个不同条目且最新项可用。回到最新后再次实际翻页成功，App 退出 0。[结果](M14-G02/9e41d1d29/attempt-046/result.json) · [达到上限](M14-G02/9e41d1d29/attempt-046/renderer-limit.png)
- A45 后续。049 对仅命中本轮测试文字的 SQLite 写入挂钩注入失败，真实输入框报错、正文保留、无回合和原生运行。052 另发现 D06-31，已从宿主分段读出的权限审批 204,454 字节，界面仍只显示 2,000 字节且给出批准选项。测试只拒绝，核对真实回包无授权。051 的夹具生成错误保留。[存储失败](M14-G02/9e41d1d29/attempt-049/result.json) · [长审批原包](M14-G02/9e41d1d29/attempt-052/result.json)
- A59 后续。同一包的合成原生协议夹具通过实际窗口验到钩子、自动审批和 MCP 启动各一项及终态修订。文件搜索与未知条目告警未投影，登记 D06-30，保留完整原结果。[复现](M14-G02/9e41d1d29/attempt-047/result.json)
- A71 已按真实 Claude SDK／CLI 通过修改及拒绝两类操作。048 错将“必须写意见”理解为确认按钮置灰。050 实测空意见提示、填入后原生收到、同一轮再次发起并在拒绝后无写入。其余计划判据继续验。[修改与拒绝](M14-G02/9e41d1d29/attempt-050/result.json)
- A26 三个独立请求同批操作完成。取消第一条后第二条正常作答，错误 owner 和旧请求都拒绝，真实浏览器只绑定原来的观察权限。原生子 Agent 发问在本轮批准的本机配置里未形成。[实包组合和缺项](M14-G03/evidence-9e41d1d29-a26-053/README.md)

## 候选包 68fbd2c79

- [打包与签名检查](build/candidate-68fbd2c79/package-68fbd2c79.log) · [ASAR 与原生组件哈希](build/candidate-68fbd2c79/package-68fbd2c79-sha256.txt)。
- A45 大权限请求可审阅完整 204,454 字节原文，拒绝后未授权。A59 的合成原生协议夹具覆盖文件搜索投影、保守未知告警及三类进行中通知修订。[权限请求](M14-G02/68fbd2c79/attempt-053/result.json) · [事件投影](M14-G02/68fbd2c79/attempt-054/result.json)。
- A71 实际点下载写出 150,071 字节 Markdown，哈希与计划原文一致，审批保持挂起。计划卡缺少来源标记和项目内保存入口，登记 M14-D06-32。[实包记录](M14-G02/68fbd2c79/attempt-055/result.json) · [界面](M14-G02/68fbd2c79/attempt-055/waiting-for-plan.png)。
- A05 在真实原生运行中复现有后台节点时后续前台输入卡在队列（M14-D06-33），以及故障重启后原生进程都已退出但节点仍显示运行中（M14-D06-34）。[后台原始记录索引](M14-G04/68fbd2c79/A05-background-index.json)。
- A30 三类目录的 U／I 和实包矩阵完整通过。[操作、三类目录截图、观察范围及保留的启动驱动失败](M14-G03/68fbd2c79/A30-directories/README.md)。

## 候选包 382d8fd76

- [打包与签名检查](build/candidate-382d8fd76/package-382d8fd76.log) · [组件哈希](build/candidate-382d8fd76/package-382d8fd76-sha256.txt)。
- A71 实包已显示 Claude 来源和项目保存按钮。056 下载完加载全文后按钮被推离可点范围，驱动没有滚动，项目保存未操作。057 先实点项目保存，项目中的 150,071 字节计划与原文一致，第二次点按明确拒绝覆盖。精确核对目录内容发现成功保存后遗留本次恢复材料。两轮 App 均退出 0。[056 原始记录](M14-G02/382d8fd76/attempt-056/result.json) · [057 字节与恢复目录](M14-G02/382d8fd76/attempt-057/result.json)。

## 候选包 37c6540bd

- [打包与签名检查](build/candidate-37c6540bd/package-37c6540bd.log) · [组件哈希](build/candidate-37c6540bd/package-37c6540bd-sha256.txt) · [类型检查](build/candidate-37c6540bd/a05-a71-typecheck.log) · [文档审计](build/candidate-37c6540bd/a05-a71-doc-audit.log)。
- [A05／A71 定向回归](software/a05-background/software.log)由八套件共 220 项覆盖，同批真实原生文件助手测试核实完整计划、冲突保护与临时材料清理。A05 覆盖原生后台仍活动时前台派发、前后台按身份停止、重启只按原进程组退出证据提交节点终态。
- A71 实包复验独立保存与下载，两个文件均为 150,071 字节且与原计划哈希完全相同。再次保存拒绝覆盖，任务目录只有明确保存的 `计划.md`，无残留临时材料，原请求保持待批准。App 退出 0。系统剪贴板留待前台条件。[实包记录](M14-G02/37c6540bd/attempt-058/result.json) · [计划卡界面](M14-G02/37c6540bd/attempt-058/waiting-for-plan.png)。
- A05 的 098 签名实包已关闭 D06-33。现行流程第一次真点停掉同一原生会话的前台回合，原 Bash 继续。第二次真点收到原后台节点原生停止回执，Bash 实际退出，未用强停；原运行排空后，下一条真实输入复用原生会话与绑定，在新运行完成。097 的重启红证单独保留，D06-34 仍有旧节点和业务运行未收口。 [正反原始记录](M14-G04/37c6540bd/A05-recheck-index.json)。
- A55 的三个定向协议反例表明空、空对象或其他回合的响应会被旧驱动假记已插话。修复后只有原回合回执能提交接受，其余进入“无法确认”而不重发。缺能力的排队证据与打包复验另验。[回执红测](software/a55-steer-receipt/a55-steer-receipt-red.log) · [受影响回归](software/a55-steer-receipt/a05-a55-agent-regression.log)。
- A18 同包验证 30 回合实际切换后的历史顺序和 256 KiB 总预算，降级历史仅带附件元数据；独占草稿附件移除和重启后仅孤儿回收通过。另发现首次交接误标增量。[预算实包](M14-G03/37c6540bd/A18-handoff/attempt-063/result.json) · [启动诊断误判](M14-G03/37c6540bd/A18-handoff/attempt-061/result.json)。

## 候选包 19d265b98

- [打包与签名检查](build/candidate-19d265b98/package-19d265b98.log) · [组件哈希](build/candidate-19d265b98/package-19d265b98-sha256.txt)。
- A05 的旧运行统一由原业务恢复服务对账，原进程组无法确定时保持占用并重查。A55 按同一回合验收原生插话回执。A18 区分执行器启动诊断与已有原生对话。 [Agent 和渲染回归](software/a55-steer-receipt/a05-a55-agent-regression.log) · [底层业务启动和恢复回归](build/candidate-19d265b98/a05-managed-recovery-regression.log)。
- A05 的 099 故障重启实包复验通过 D06-34。以原 PID／出生身份核空旧进程组，旧节点、旧宿主原生运行及业务 CLI 登记都收口。重启后实际发送使用相同原生会话、绑定和新运行代次，App 正常退出。真实模型层另验。 [重启复验](M14-G04/19d265b98/attempt-099/result.json) · [继续原会话](M14-G04/19d265b98/attempt-099/03-continued-same-native-binding.png)。
- A55 实包按真实输入框插话按钮取证。错配回执标接收未知、无额外请求；匹配回执归同一原生回合，正常完成。两例 App 正常退出。059 在原生回合确认前读取状态，属于驱动失败，已保留。完整的可选能力矩阵继续验。[错配](M14-G02/19d265b98/A55-steer/attempt-061/result.json) · [匹配](M14-G02/19d265b98/A55-steer/attempt-062/result.json) · [原驱动失败](M14-G02/19d265b98/A55-steer/attempt-059/result.json)。

## 候选包 0686607c0

- [打包与签名检查](build/candidate-0686607c0/package-0686607c0.log) · [组件哈希](build/candidate-0686607c0/package-0686607c0-sha256.txt)。
- 已保存的 Codex 供应商配置明确声明目标模型不接收图像时，模型输入仅含附件名称和省略说明，本机保留原附件，任务界面显示实际发送状态。[95 项软件回归](build/candidate-0686607c0/a18-image-modality-software.log) · [类型检查](build/candidate-0686607c0/a18-image-modality-typecheck.log)。
- A18 的 066 实点切换到新纯文本 Codex，原生交接正文哈希与库一致，标为“全量”。新图未进入实际模型请求，界面给出明确说明，原附件保留且哈希不变。D06-36 与 D06-37 已复验。另在渲染回归确认中途切走仍会请求旧条目的后续分段（D06-38），修复后继续跑包。[全量与纯文本模型实包](M14-G03/0686607c0/A18-handoff/attempt-066/result.json) · [取消读取红测](software/a18-cancel-read/a18-read-cancel-red.log) · [渲染复验](software/a18-cancel-read/a18-read-cancel-green.log)。
- A18 的 067 真点取消两条排队输入，确认两条都未开启原生回合。独占冻结图删除，仍被已结束回合引用的那张 SHA 不变。之后归档只读仍可见，实际删除同一隔离项目后，该份附件删除而原图保留。App 正常退出。 [同一附件的取消、归档和删除](M14-G03/0686607c0/A18-handoff/attempt-067/result.json)。

## 候选包 b241b547e

- [打包与签名检查](build/candidate-b241b547e/package-b241b547e.log) · [组件哈希](build/candidate-b241b547e/package-b241b547e-sha256.txt) · [类型检查](build/candidate-b241b547e/a18-read-cancel-typecheck.log)。
- 阅读者切离原任务后停止继续请求它的正文分段；已在途的响应不能触发后续请求或修改新界面。[真实组件定向红测和全量渲染回归](software/a18-cancel-read/a18-read-cancel-green.log)。
- A18 的 068 对 417,648 字节真实原生合成正文实点“展开全文”。原 IPC 第二段延迟时，通过实际侧栏切任务；放行后没有第三段请求，新任务正常作答且没有旧正文串入。拆除门闩重启后再实点全文，5 段同原始 SHA，原交接遗漏仍可查。两次 App 正常退出。本批结合 063、066、067 和 U／I，A18 通过。[真实取消和完整回读](M14-G03/b241b547e/A18-canceled-read/result.json)。
- A38 的 101 真点引用与两种切换，原草稿和编辑缓冲保留。Cmd+S 原处理器与独立进程外改交错返回冲突，真实选择保留修改后按当前哈希写盘。102 合成语音仅核产品按钮、切任务取消、草稿路由和不自动发送；未运行 Typeless。三个 App 均退出 0。 [文件保存、冲突与语音证据边界](M14-G04/b241b547e/A38/A38-evidence-index.json)。

## 候选包 15be1a81e

- [打包与签名检查](build/candidate-15be1a81e/package-15be1a81e.log) · [组件哈希](build/candidate-15be1a81e/package-15be1a81e-sha256.txt) · [Agent 和渲染回归](software/a55-method-probes/a55-all-agent-regression.log)。
- A55 实包缺插话和 Skill 时只关闭相应能力、普通发送排队；缺 reviewer 时请求批准档明确拒绝，无 turn/start；高于最低版本的已启用能力仍工作。三次 App 正常退出。升级时在用程序的独立判据继续验。[排队](M14-G02/15be1a81e/A55-capability/attempt-063/result.json) · [档位拒绝](M14-G02/15be1a81e/A55-capability/attempt-064/result.json) · [新版正常插话](M14-G02/15be1a81e/A55-capability/attempt-065/result.json)。
- A31 在 Git 共用、实际 SVN 工作副本和普通目录实包均验证同一物理根 FIFO、单 writer、回执原父及改向后拒绝。三次正常退出。 [三目录和 U／I 证据](M14-G03/15be1a81e/A31-directory-fifo/README.md)。
- A55 的 068 在旧 CLI 原回合仍活动时，通过真实设置检测并保存另一份较新测试 CLI，旧 PID 和 run 保留，新任务实际使用新 PID 与路径。069 在同包分别对低于最低版本与握手缺失，从实际报错入口确认原因且没有活跃 run。两个 App 均正常退出；066／067 分别是未等设置回执和两个人工程序共用原生会话 ID 的夹具失败，保留。A55 全部通过。[升级](M14-G02/15be1a81e/A55-capability/attempt-068/result.json) · [低版本与基础协议](M14-G02/15be1a81e/A55-capability/attempt-069/result.json)。

- A16 的 073 覆盖派发前失败、明确拒绝后重试、发出后断开以及接受后回执丢失。在四个隔离实包进程中验证重启后仍保留正确状态，重复标识返回原收据。全部正常退出。结合 140 项软件回归，A16 通过。[实包、回归及前三次失败](M14-G02/15be1a81e/A16-input-receipts/README.md)。

## 候选包 e17b6c79e

- 修复 D06-40 的宿主审批回执。普通业务执行成功和错误仍按原 CLI 契约返回；等待用户的业务通过单独格式输出准确的能力、请求 ID 和操作 ID。旧包 104 的原生回执与后续审批两阶段已经对账。[问题实包与红测](M14-G04/15be1a81e/A37-browser/README.md)。
- [构建及六项原生检查](build/candidate-e17b6c79e/package-e17b6c79e.log) · [构建组件 SHA-256](build/candidate-e17b6c79e/package-e17b6c79e-sha256.txt) · [32 项宿主、CLI 与入口回归](build/candidate-e17b6c79e/a37-cli-receipt-green.log) · [类型检查](build/candidate-e17b6c79e/a37-cli-receipt-typecheck.log)。新包 A 层及应用模块全量回归待完成。

- 新包 105 真实 CLI 的等待回执与实际批准后业务拒绝逐 ID 对账，D06-40 已复验；Stop、迟到批准和用户继续浏览通过。Ask 原驱动的字段断言失败及原包结果保留，未关闭整条 A37。[原始结果与独立核对](M14-G04/e17b6c79e/A37-browser/attempt-105/README.md)。

## 候选包 b82556cbc

- D06-41 改为按所有者和请求锁定待处理审批。等待同一请求的回执时可继续处理其他请求，原请求自身仍防止重复提交，仍可撤销。旧回执不会转移当前选择。[旧包实测与定向红测](M14-G03/e17b6c79e/A32-business-red/README.md)。
- [打包签名与原生检查](build/candidate-b82556cbc/package-b82556cbc.log) · [组件哈希](build/candidate-b82556cbc/package-b82556cbc-sha256.txt) · [100 项渲染与宿主测试](build/candidate-b82556cbc/a32-parallel-request-green.log) · [类型检查](build/candidate-b82556cbc/a32-parallel-request-typecheck.log)。

- A32 的 082 实包完成普通目录 Claude→Codex。真实业务运行中另一原生审批照常确认，真实业务完成、原父退出后才交槽。结合 Git、SVN 与普通目录其余五组，A32 整条通过，D06-41 已复验。[六组矩阵和业务排空](M14-G03/b82556cbc/A32-business/README.md)。

- A37 的 106 实包确认完全访问不会放宽观察授权，CLI 直接拒绝对应浏览器写操作。107 真实父子功能已取证，正常退出超时保留并待复验。[完全访问和父子授权](M14-G04/b82556cbc/A37-browser/README.md)。

- A24 的 086 真实原生回包在领取后切断，原父没有收到正文，宿主通知仍只送一次。实际后继运行通过原生 MCP 读取同一子任务的同修订和正文，App 正常退出。A24 整条通过。[故障、续读和软件回归](M14-G03/b82556cbc/A24-transport/README.md)。

## 候选包 2521f1b41

- D06-42 在核实原宿主退出后收口已跨写入边界的操作账为结果未知。旧包遗留的同类记录沿用原宿主退出证据处理。运行和进程的占用仍由原有进程身份规则核对。[旧包实际重启及活动账反例](M14-G03/b82556cbc/A27-attempt085/README.md)。
- [打包签名与原生检查](build/candidate-2521f1b41/package-2521f1b41.log) · [组件哈希](build/candidate-2521f1b41/package-2521f1b41-sha256.txt) · [83 项运行恢复及活动账回归](build/candidate-2521f1b41/a27-interrupted-write-green.log) · [类型检查](build/candidate-2521f1b41/a27-interrupted-write-typecheck.log)。

- A27 的 087 实包故障复验确认原进程清理、活动账结为结果未知、写入不重放和同一排队输入手动续跑。重启 App 正常退出。D06-42 关闭，A27 整条通过。[真实重启与终态账](M14-G03/2521f1b41/A27-recovery/README.md)。

- A37 的 108 真实父子授权于通知与队列排空后正常退出，109 在真正 SVN 写槽交接中验证同一待绑定请求只绑定新登记运行。完整重启、提前停止和撤销等仍待。[两次实包与正常退出](M14-G04/2521f1b41/A37-browser/README.md)。

- 该提交的 M13 应用全量回归已启动。并行完成了 A06、A10、A28 实包驱动的离线预检和 75 项相关软件测试。[预检及证据边界](software/a06-a10-a28-preflight/README.md)。

- A37 的冷启动授权已发现软件集成反例。原已审阅的标签仍在持久工作区，零原生视图时旧核对会误报目标不存在。修复提交 `c098d03dc` 的定向回归及类型检查已通过，旧包真实重启与新包复验待执行。[D06-43 反例和修复](software/a37-restart-c098d03dc/README.md)。

- M13 全量回归在 `2521f1b41` 的冻结源码上结束。首轮唯一失败是稀疏工作树缺少同一提交的禅道测试夹具。补齐 9 个文件、逐个核对原始字节后定向复跑通过。合计 2,381 项通过、9 项条件跳过。[全量、夹具和复跑记录](software/m13-2521f1b41/README.md)。

- A37 旧候选 110 的实际冷启动复现 D06-43。原审批和标签均存在，实际后继登记后误退役，无授权生成。重启 App 正常退出。[旧包 110 对照](M14-G04/2521f1b41/A37-browser/attempt-110/README.md)。

## 候选包 c098d03dc

- D06-43 已完成签名打包，六项原生检查通过。旧包独立保留。A37 新包的重启、绑定前停止和撤销进入实际复验。[签名构建与原生检查](build/candidate-c098d03dc/package-c098d03dc.log) · [构建组件 SHA-256](build/candidate-c098d03dc/package-c098d03dc-sha256.txt)。

- A37 修复包 112、113 真实点击停止和撤销。两条待绑定授权均退役，新运行的真实浏览器 CLI 均拒绝读取。111 冷启动观察实际绑定成功，因驱动串行读取跨时点，尚未取到实际读取原页的证据。[实包记录](M14-G04/c098d03dc/A37-browser/README.md)。

- A25 的 088 实包已证明父回合完成时，运行子任务、后台命令和业务审批同时活跃。收口途中夹具未识别 Claude 原生目标判定请求，逐项结束和目标汇总待补验。[实际状态与夹具失败](M14-G03/c098d03dc/A25-tree/attempt-088/README.md)。

- A28 的 074 实包证明旧 Claude 提问和已收据的排队输入均由原运行处理，随后才应用切换，新输入只进新 Codex。结合已有单／多模式、封新委派和迟到结果证据，A28 整条通过。[实包证据](M14-G02/c098d03dc/A28-deferred-switch/README.md)。

- A37 114 确认冷启动时同一批准仍待绑定，真实新运行登记后才绑定并发通知。原生 CLI 随后读到同一页面原文，运行结束时授权撤销。D06-43 已实包复验，A37 的 M15 无人值守判据保留待验。[冷启动、实际读取与退出证据](M14-G04/c098d03dc/A37-browser/attempt-114/verified-114-candidate-restart.json)。

- A06 075／077 本机实包确认健康 Codex 不被 Claude 的 401 重试拖住。错误分类、代理故障与恢复仍待验。[两次尝试](M14-G02/c098d03dc/A06-provider/README.md)

- A10 076 实包两份纳管配置未投影到新任务运行（D06-44）。修复已本地提交并通过 75 项软件测试和类型检查。[负例与修复](M14-G02/c098d03dc/A10-managed-mcp-red/README.md)。

## 候选包 1f94f27ba

- 纳管 MCP 接线修复 D06-44 已签名打包，六项原生检查通过。[构建日志](build/candidate-1f94f27ba/package-1f94f27ba.log) · [组件校验值](build/candidate-1f94f27ba/package-1f94f27ba-sha256.txt) · [75 项有关测试](build/candidate-1f94f27ba/a10-projection-green.log)。

- A10 的 078 修复包在两个实际原生执行器各启动两份纳管 MCP。原宿主工具仍发布，模型鉴权和内部槽未进入四个真实 MCP 进程，显式自有变量保持，配置文件不变。App 退出正常。D06-44 关闭，A10 整条通过。[四个 MCP 进程及精确收尾](M14-G02/1f94f27ba/A10-managed-mcp/README.md)。

- A06 的 080 确认 401、502 的实际终态分别归正确配置，健康 Codex 保持原会话，故障 Claude 用原选配置恢复。未知写操作不重放还需 A06 独立场景。[故障和恢复实包](M14-G02/1f94f27ba/A06-provider/README.md)。

- 冻结源码 `1f94f27ba` 的 Agent、能力管理、AI 配置和任务渲染回归通过，67 个文件通过、4 个文件条件跳过，918 项通过、9 项条件跳过，无失败。目录覆盖 `src/main/core/agent`、`src/main/core/capabilities`、`src/main/core/ai` 和 `src/renderer/features/agent-tasks`。[扩围软件测试](build/candidate-1f94f27ba/agent-capabilities-round-1f94f27ba.log)。

- A06 的 093 实包证明既有同任务未知写操作遇到真实 401 并恢复时保持单次调用与原效果，正常退出后仍未重放。结合 080 和原 U／I，A06 整条通过。[旧故障、401、恢复及最终写入账](M14-G03/1f94f27ba/A06-unknown-write/README.md)。

- A09 081 通过两端真实 HTTP 握手、原认证与字面请求头。082 实包确认未实现等价投影的超时和嵌套策略被旧包忽略（D06-45），已修代码待新包。[HTTP 与字段证据](M14-G02/1f94f27ba/A09-http-projection/README.md)。
- A26 089 确认能同时处理两条真实宿主子问题及网页授权。Claude 2.1.326 在原生层不开放子 Agent 的 AskUserQuestion，第四路未通过。[来源、回应及能力边界](M14-G03/1f94f27ba/A26-native-child/README.md)。

## 候选包 25516433f

- D06-45 在投影前校验未知字段的修复已签名打包，六项原生检查通过。[构建与原生检查](build/candidate-25516433f/package-25516433f.log) · [组件校验值](build/candidate-25516433f/package-25516433f-sha256.txt) · [102 项软件回归](build/candidate-25516433f/a09-fields-green.log)。

- A09 修复包 083 以同一声明复验，原两个 HTTP 服务仍在两端真实接通，两个语义不明的服务请求均为 0，给出字段诊断，同时保留原配置。D06-45 关闭，A09 的其他判据继续执行。[真实对照](M14-G02/25516433f/A09-managed-fields/README.md)。

- A39 的 117／118 已证明四种 MCP 同场与停止 Agent 保留原查看器。118 确认文件标签被继承的偏移移出可点击区（D06-46），已修代码待新包。[同场、几何与原始失败](M14-G04/25516433f/A39-mcp-and-file-tabs/README.md)。

- A39 119 通过 D06-46 文件标签实际关闭、旧文档作用域拒绝及 renderer 换代。真实窗口销毁待取证。[119 修复包](M14-G04/e779d4e17/A39-mcp-and-file-tabs/README.md)。
- D06-46 候选打包附带六项原生自检。受影响渲染端批次及同源码原生定向复验合并 1,316 通过，675 条条件跳过。[构建与回归](build/candidate-e779d4e17/README.md)。
- A25 实包分项验证同树后台、业务请求与托管子逐项收口，以及独立真实 Codex 目标明确完成。同树目标后半仍待验。[120 与 122](M14-G03/e779d4e17/A25-task-tree/README.md)。
- A39 123 补齐真实窗口销毁、旧引用拒绝和新查看器读回，U／I 补验 18 项通过，整条关闭。[窗口关闭与重开](M14-G04/e779d4e17/A39-mcp-and-file-tabs/README.md)。
- A58 126 实包确认无项目历史消息的网页点击被拦截，另保留 124 测试夹具意外打开隔离合成文件的真实回执。系统层仍待验。[网页正反与外部调用回执](M14-G04/e779d4e17/A58-link-routes/README.md)。
- A25 130 在同一真实 Codex 父任务树补齐原父回合完成、托管子／后台／待审批分别收口、树空闲而目标仍未完成，最后原生工具明确完成同一目标。U／I／A 整条关闭。[完整实包](M14-G03/e779d4e17/A25-task-tree/README.md)。
- A09／A11 的 D06-47 在 128／129 实包重现外部表单约束丢失、URL 仍可提交及 Claude 回调缺口，已按 F05 加 cancel 门禁并待修复包。[两端原始请求与旧包](M14-G02/e779d4e17/A09-elicitation/README.md)。
- A09／A11 的 D06-47 在 132（表单）和 133（URL）通过新包复验。两端均真实收到 cancel，无网页访问或提交，App 正常退出。[四个原生请求](M14-G02/4da61749f/A09-elicitation/README.md)。
- A58 134 同一真实 Claude 运行在普通点击 PDF 前后确证授权相同，PDF.js 保留原私有查看器。系统修饰键和外部接收另验。[权限证据](M14-G04/4da61749f/A58-pdf-authority/README.md)。
- D06-47 最新候选四模块回归 925 项通过、9 条条件跳过，包含默认 runner 拒绝本机回环后同源码的定向复验。[回归及构建](build/candidate-4da61749f/README.md)。
- A66 136 验证两个独立工作副本、Maven 跳过、后台退出后才提交、单次通知。退出阶段的父通知仍活动，保留限制及 135 原先夹具失败。[实包过程](M14-G03/4da61749f/A66-worktree-maven/README.md)。
- A09 140 补齐双向 stdio、四个实际进程的 argv／cwd／变量，以及来源工具禁用、停用整个 MCP。结合 HTTP、不等价字段和原生请求，整条关闭。[stdio 实包](M14-G03/4da61749f/A09-stdio/README.md)。
- A33 141 通过只读、排空、转写与实际重读 V2；142 在普通 shell 已获写权限后仍能跳过重读覆盖新版本，等待确认强制校验范围。[实包正反](M14-G03/4da61749f/A33-read-promotion/README.md)。
- A66 144 补验实际离线 npm 安装失败、两端子任务照常运行。独立核实七个真实回合完成、App 退出 0；其余组合仍待验。[回执](M14-G03/4da61749f/A66-worktree-maven/README.md)。
- A60 148 补验真实 Claude 输出上限、部分保留与手动继续。原生同轮续接与宿主新轮分开计证。[真实过程](M14-G04/4da61749f/A60-native-limits/README.md)。

- A60 149 复现 D06-48，Codex 原生输出上限被旧包标为普通失败，已补原生错误映射并待实包复验。[原生、宿主与 UI 对照](M14-G04/4da61749f/A60-native-limits/attempt-149/verified-149-codex-output-red.json)。
- A04 150 复现 D06-49，准备阶段按停止后仍迟到启动原生进程，未发出模型请求。[原始动作和运行身份](M14-G03/4da61749f/A04-prepare-stop/attempt-150/result.json)。
- A33 151 按用户已确认范围补齐宿主管理文件的写前校验，磁盘 V2 与本地草稿在冲突时同时保留，明确处理后从 V2 保存成功。三目录只读与 shell 重读结合文件保存判据，整条关闭。[实包记录及两张截图](M14-G04/4da61749f/A33-managed-save/README.md)。

- 签名候选 1da88d8f8 六项原生检查与 379 项软件回归通过。[构建与软件证据](build/candidate-1da88d8f8/README.md)。
- A04 D06-49 同包 152 和 154 均无迟到 fork，154 补齐进程预留取消的真实数据库断言，确认旧运行和占用收口。其余 A04 步骤仍待验。[修复后对照](M14-G03/1da88d8f8/A04-prepare-stop/README.md)。
- A60 155 通过 Codex 真实输出上限与实际手动继续，D06-48 关闭。153 驱动前置失败保留。其余终态仍待验。[原生及打包界面证据](M14-G04/1da88d8f8/A60-codex-output/README.md)。
- A04 157 通过真实出生后、业务 CLI 登记前的停止。158 发现实际停止后原业务桥仍迟到认证（D06-50），无业务执行，已留原始回执。[同包正反与环境前置](M14-G03/1da88d8f8/A04-post-fork/README.md)。
- A38 160 验证实际应用结果插入后切任务和 Provider，草稿与未保存文件保持各自状态，没有自动发送。真实系统语音继续单列。[实包及 159 对照](M14-G04/1da88d8f8/A38-application-switch/README.md)。
- A04 161 在同一真实握手窗口复验通过，按停止后旧桥请求明确拒绝，未获认证；待两端旧代次等判据。D06-50 关闭。[桥停止正反证据](M14-G03/1da88d8f8/A04-post-fork/README.md)。
- A60 165 复现 D06-51，真实 Codex 重置时间漏投影。跨真实时点后仍安静，手动继续有效。[额度实包对照](M14-G04/703ec066f/A60-codex-usage/README.md)。
- A14 已跑同配置换模型、同执行器换 Provider、跨执行器及两端目标的任务隔离。全部目标、在途与委派余项继续验收。[164／166 实包证据](M14-G04/703ec066f/A14-selection/README.md)。
- A04 167 完成 Codex 同绑定两代与三个真实桥身份拒绝。原 163 观察器事故及同包对照保留。[身份和事故证据](M14-G03/703ec066f/A04-authority/README.md)。
- A60 168 的结构化额度时间与界面同值，过真实时点无自动续跑，实际点继续才启动一轮并完成。D06-51 关闭。[原生和界面正反](M14-G04/703ec066f/A60-codex-usage/README.md)。
- A04 170 补齐 Claude 同一原生会话与绑定的两代、复制句柄和自报字段，实际拒绝、退出和释放均核实。结合 Codex 与三个启动时点，整条关闭。[Claude 实包](M14-G03/4f1d4c0a2/A04-claude-authority/README.md)。
- A14 171／173 实包确认等待真实子任务时的目标锁定与原生跨执行器委派，并发现子任务刚完成就清除目标时原会话尚未就绪（D06-52）。[真实回执](M14-G04/4f1d4c0a2/A14-waiting-goal/README.md)。
- A14 175 首击在后继运行激活前发生，等会话就绪后一次清除成功并切换。结合其他三类切换和在途证据，整条关闭。[同夹具红绿](M14-G04/4f1d4c0a2/A14-waiting-goal/README.md)。

- A60 177 补过 Claude 回合自然失败后仍可处理原审批的实包判据。实际确认后只生成一份本地草稿，结果回到同一会话，邮件发送记录为零。[176／177 原始证据](M14-G04/463155a0f/A60-host-failure/README.md)。

- A17 178 已观察到当前真人输入的合成草稿真实审批收口。夹具误读了原生业务通知的分块，历史对照尚未执行。隔离进程已完整清理，整条不计通过。[原结果和清理证据](M14-G03/463155a0f/A17-local-draft/README.md)。

- A17 180 补过同一原生会话中的当前输入／历史审批对照。仅一份本地草稿，无发送。[实包与独立账核对](M14-G03/463155a0f/A17-local-draft/README.md)。

- A60 179 发现同一用户停止重复下发 Codex 原生中断（D06-53）。源修复通过受影响测试，新包正在复验。[实包红测与回归](M14-G04/463155a0f/A60-pre-ack-stop/README.md)。

- A60 181 原生轮数上限前置未成立，夹具提前停住并正常退出。[前置记录](M14-G04/463155a0f/A60-max-turns/README.md)。

- A60 183 在新包实测提前停止只发送一次原生中断，同一 Codex 会话可手动续聊；D06-53 关闭。[旧包反例、复验与签名包](M14-G04/684a0b6a1/A60-pre-ack-stop/README.md)。

- A60 184 在真实 Codex 命令审批挂起时点停止，原请求退役，旧批准在后继回合前后都被拒。测试文件无写入，App 正常退出。[原生与 UI 核对](M14-G04/684a0b6a1/A60-native-pending-stop/README.md)。

- A60 186／187 完成真实 Claude 轮数上限和无注入对照。上限组明确失败、三项工具收口、错误详情可展开，对照正常收口。保留 181／185 的夹具误判。[双组证据](M14-G04/684a0b6a1/A60-max-turns/README.md)。

- A59 189 在旧签名包复现审批等待计入工作时间（D06-54）。宿主日志显示等待 4,596ms、工作 55ms，界面显示已工作 5 秒。源码回归 387 项通过，新包复验中。[实包及回归](M14-G03/684a0b6a1/A59-work-timing/README.md)。

- A59 190 通过计时同场景复验，D06-54 关闭。实际确认界面工作与审批等待分列，App 和 CLI 正常退出。[复验证据](M14-G03/1b1680eea/A59-work-timing/README.md)。

- A59 192 复现 D06-55：下一轮确实混入上一轮迟到的 Codex 原生片段。194 另有真实两工具重叠且计时正确的旁证，夹具文件换行失败保留。[原证和源码回归](M14-G03/1b1680eea/A59-late-delta/README.md)。

- A40 193 复现 D06-56：含冻结 Skill 的新任务未完成准备，原生未启动。两个执行器的集成回归都通过，新包实测待补。[实际首页与 DB](M14-G04/1b1680eea/A40-frozen-plugin/README.md)。

- A59 196 复验关闭 D06-55。晚到的原字节不复活旧条目、不混入下一轮预览，两个最终回答各一条。[同路径实包复验](M14-G03/2b0af2f96/A59-late-delta/README.md)。

- A63 197 交叉完成 U／I、打包 App 与原生 R 验证。实际恢复同一 Codex 线程后连续两轮都向用户申请批准，唯一被批准文件有实际内容，两次拒绝无写入。[实包与两项独立 R 控制](M14-G04/2b0af2f96/A63-reviewer/README.md)。

- A40 201 用原生 Claude 实际读取冻结 Skill 的相对资源，新任务可启动并完成插件调用。D06-56 实包复验完成，升级、停用、卸载继续验收。 [原生回执与失败边界](M14-G04/2b0af2f96/A40-frozen-plugin/README.md)。

- A59 202、204、207 完成全部 U／I／A 判据。实包原生工具按一组显示且重叠时间不重复，Claude 子终态不结束原父回合，合成 Codex 协议的结构化待办走真实产品投影。 [完整覆盖矩阵](M14-G03/2b0af2f96/A59-native-work/覆盖矩阵.md)。

- A40 208 实测兼容与不兼容升级、210 实测保留数据卸载通过。209 原插件回执实际返回，宿主停用后却将同一已执行调用记为失败，登记 D06-57。源修复仅允许原运行、原租约交付，维持新调用的即时授权。 [两组通过及一组实际失败](M14-G04/2b0af2f96/A40-frozen-plugin/README.md)。

- A40 新候选 211–213 通过停用、更新和保留数据卸载，D06-57 关闭。受影响回归 183 项和类型检查通过。 [新包逐项结果及回归](M14-G04/1214412aa/A40-lifecycle/README.md)。

- A83 第 344 次补齐 P3。真实 Codex 子读取当前改动，实际 TAP 通过 1、失败 0。同根独立任务沿用原运行，包和原生进程正常收口。至此 U／I／R／A 判据通过。 [P3 实包证据](M14-G03/2b78058ec/A83-plain/README.md)。

- 共用目录协作组的缺陷编号已改为 D06-58 至 D06-61，分别对应写入队列状态、子结果卡片、宿主排队通知和写入子任务提示。 [同批缺陷与复验](M14-G03/1214412aa-claude-shared/README.md)。

- A37 在 M15 触发移出后逐项核封存实包，观察和控制、61 秒等待、父子、后继绑定、冷重启与退役均有实际证据，U／I／A 通过。 [闭环复核](M14-G04/2b78058ec/A37-review/README.md)。
